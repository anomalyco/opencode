import { readdir, stat } from "node:fs/promises"
import path from "path"
import { fileURLToPath } from "node:url"
import type {
  OpencodeClient,
  PermissionRequest,
  PermissionV2Request,
  QuestionRequest,
  QuestionV2Request,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  ToolPart,
  V2Event,
} from "@opencode-ai/sdk/v2"
import { blockerStatus, pickBlockerView } from "./session-data"
import { authoredPromptText } from "./session.shared"
import { writeSessionOutput } from "./stream"
import type {
  FooterApi,
  FooterView,
  LocalReplayAnchor,
  LocalReplayRow,
  RunFilePart,
  RunInput,
  RunPrompt,
  RunPromptPart,
  RunProvider,
  StreamCommit,
} from "./types"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { isImageAttachment, isPdfAttachment, sniffAttachmentMime } from "@/util/media"

type Trace = {
  write(type: string, data?: unknown): void
}

type StreamInput = {
  sdk: OpencodeClient
  directory?: string
  localFilesystem?: boolean
  sessionID: string
  thinking: boolean
  replay?: boolean
  replayLimit?: number
  limits: () => Record<string, number>
  providers?: () => RunProvider[]
  footer: FooterApi
  trace?: Trace
  signal?: AbortSignal
}

export type SessionTurnInput = {
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
  prompt: RunPrompt
  files: RunFilePart[]
  includeFiles: boolean
  onVisibleOutput?: (anchor: LocalReplayAnchor) => void
  signal?: AbortSignal
}

export type SessionResizeReplayInput = {
  localRows: () => LocalReplayRow[]
  reset: () => Promise<void>
}

export type SessionTransport = {
  runPromptTurn(input: SessionTurnInput): Promise<void>
  interruptActiveTurn(): Promise<void>
  selectSubagent(sessionID: string | undefined): void
  replayOnResize(input: SessionResizeReplayInput): Promise<boolean>
  close(): Promise<void>
}

type Wait = {
  messageID: string
  promoted: boolean
  interrupted: boolean
  failureRendered: boolean
  resolve: () => void
  reject: (error: unknown) => void
  onVisibleOutput?: (anchor: LocalReplayAnchor) => void
}

type RunV2Event = V2Event
type PromptFilePart = Extract<RunPromptPart, { type: "file" }>

type ToolState = {
  messageID: string
  name: string
  input: Record<string, unknown>
  started: number
  running: boolean
}

type State = {
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  view: FooterView
  messageIDs: Set<string>
  text: Map<string, string>
  projectedText: Map<string, string>
  reasoning: Map<string, string>
  projectedReasoning: Map<string, string>
  tools: Map<string, ToolState>
  finishedTools: Set<string>
  wait?: Wait
  connected: boolean
  closed: boolean
  initial: boolean
  buffered?: RunV2Event[]
  errors: Set<string>
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096

export function formatUnknownError(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message || error.name
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message")
    if (typeof message === "string" && message.trim()) return message
    const tag = Reflect.get(error, "_tag")
    if (typeof tag === "string" && tag.trim()) return tag
  }
  return "unknown error"
}

function permission(request: PermissionV2Request): PermissionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: request.resources,
    metadata: request.metadata ?? {},
    always: request.save ?? [],
    tool: request.source?.type === "tool" ? request.source : undefined,
  }
}

function question(request: QuestionV2Request): QuestionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    questions: request.questions,
    tool: request.tool,
  }
}

function outputText(content: Array<{ type: string; text?: string }>) {
  return content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n")
}

function legacyTool(input: {
  sessionID: string
  messageID: string
  callID: string
  name: string
  state: SessionMessageAssistantTool["state"]
  time: SessionMessageAssistantTool["time"]
  provider?: SessionMessageAssistantTool["provider"]
}): ToolPart {
  const base = {
    id: `prt_${input.callID}`,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool" as const,
    callID: input.callID,
    tool: input.name,
  }
  if (input.state.status === "pending") {
    return {
      ...base,
      state: { status: "pending", input: {}, raw: input.state.input },
    }
  }
  if (input.state.status === "running") {
    return {
      ...base,
      state: {
        status: "running",
        input: input.state.input,
        title: input.name,
        metadata: { structured: input.state.structured, content: input.state.content, providerCall: input.provider },
        time: { start: input.time.ran ?? input.time.created },
      },
    }
  }
  if (input.state.status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input: input.state.input,
        output: outputText(input.state.content),
        title: input.name,
        metadata: {
          structured: input.state.structured,
          content: input.state.content,
          outputPaths: input.state.outputPaths,
          result: input.state.result,
          providerCall: input.provider,
        },
        time: { start: input.time.ran ?? input.time.created, end: input.time.completed ?? input.time.created },
      },
    }
  }
  return {
    ...base,
    state: {
      status: "error",
      input: input.state.input,
      error: input.state.error.message,
      metadata: {
        structured: input.state.structured,
        content: input.state.content,
        result: input.state.result,
        providerCall: input.provider,
      },
      time: { start: input.time.ran ?? input.time.created, end: input.time.completed ?? input.time.created },
    },
  }
}

function toolCommit(part: ToolPart, phase: "start" | "progress" | "final"): StreamCommit {
  const status = part.state.status
  const text =
    status === "running"
      ? part.tool === "task"
        ? "running task"
        : `running ${part.tool}`
      : status === "completed"
        ? part.state.output
        : status === "error"
          ? part.state.error
          : ""
  return {
    kind: "tool",
    source: "tool",
    text,
    phase,
    messageID: part.messageID,
    partID: part.id,
    tool: part.tool,
    part,
    toolState: status === "error" ? "error" : status === "completed" ? "completed" : "running",
    toolError: status === "error" ? part.state.error : undefined,
  }
}

function sessionID(event: RunV2Event) {
  return "sessionID" in event.data && typeof event.data.sessionID === "string" ? event.data.sessionID : undefined
}

function errorMessage(error: { message?: string; _tag?: string }) {
  return error.message || error._tag || "Session execution failed"
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}

async function prepareFile(file: RunFilePart) {
  if (file.mime !== "text/plain") return { attachment: { uri: file.url, mime: file.mime, name: file.filename } }
  const content = file.url.startsWith("data:")
    ? Buffer.from(file.url.slice(file.url.indexOf(",") + 1), "base64").toString("utf8")
    : await Bun.file(new URL(file.url)).text()
  return { text: `<file name="${file.filename}">\n${content}\n</file>` }
}

function isBinaryContent(bytes: Uint8Array) {
  if (bytes.length === 0) return false
  if (bytes.includes(0)) return true
  return bytes.reduce((count, byte) => count + Number(byte < 9 || (byte > 13 && byte < 32)), 0) / bytes.length > 0.3
}

function promptFileSource(part: PromptFilePart) {
  if (!part.source?.text) return
  return {
    start: part.source.text.start,
    end: part.source.text.end,
    text: part.source.text.value,
  }
}

function isResourcePromptFile(part: PromptFilePart) {
  return part.source?.type === "resource"
}

function promptFilePage(url: URL) {
  const start = url.searchParams.get("start")
  if (!start) return
  const offset = Number.parseInt(start, 10)
  if (!Number.isFinite(offset) || offset < 1) return
  const endValue = url.searchParams.get("end")
  if (!endValue) return { offset }
  const end = Number.parseInt(endValue, 10)
  if (!Number.isFinite(end) || end < offset) return { offset }
  return { offset, limit: end - (offset - 1) }
}

function readArgs(filePath: string, page?: { offset?: number; limit?: number }) {
  return {
    filePath,
    ...(page?.offset === undefined ? {} : { offset: page.offset }),
    ...(page?.limit === undefined ? {} : { limit: page.limit }),
  }
}

function readCall(filePath: string, page?: { offset?: number; limit?: number }) {
  return `Called the Read tool with the following input: ${JSON.stringify(readArgs(filePath, page))}`
}

function readFailure(filePath: string, message: string) {
  return `Read tool failed to read ${filePath} with the following error: ${message}`
}

function streamPartKey(messageID: string, partID: string) {
  return `${messageID}\u0000${partID}`
}

function decodeTextDataUrl(uri: string) {
  if (!uri.startsWith("data:")) return
  const comma = uri.indexOf(",")
  if (comma === -1) return
  const meta = uri.slice(5, comma)
  const mime = meta.split(";")[0]?.toLowerCase() ?? ""
  if (mime !== "text/plain" && !mime.startsWith("text/")) return
  const body = uri.slice(comma + 1)
  if (meta.toLowerCase().includes(";base64")) return Buffer.from(body, "base64").toString("utf8")
  return decodeURIComponent(body)
}

async function sampleFile(filePath: string) {
  const file = Bun.file(filePath)
  return new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer())
}

async function readLocalDirectory(filePath: string, page?: { offset?: number; limit?: number }) {
  const entries = await Promise.all(
    (await readdir(filePath, { withFileTypes: true })).map(async (entry) => {
      if (entry.isDirectory()) return entry.name + "/"
      if (entry.isFile()) return entry.name
      if (!entry.isSymbolicLink()) return
      const target = await stat(path.join(filePath, entry.name)).catch(() => undefined)
      if (!target) return
      return target.isDirectory() ? entry.name + "/" : entry.name
    }),
  ).then((items) => items.filter((item): item is string => Boolean(item)).sort((a, b) => a.localeCompare(b)))
  const offset = page?.offset ?? 1
  const limit = page?.limit ?? DEFAULT_READ_LIMIT
  const start = offset - 1
  const sliced = entries.slice(start, start + limit)
  const truncated = start + sliced.length < entries.length
  return [
    `<path>${filePath}</path>`,
    `<type>directory</type>`,
    `<entries>`,
    sliced.join("\n"),
    truncated
      ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
      : `\n(${entries.length} entries)`,
    `</entries>`,
  ].join("\n")
}

async function readLocalTextFile(filePath: string, page?: { offset?: number; limit?: number }) {
  const offset = page?.offset ?? 1
  const limit = page?.limit ?? DEFAULT_READ_LIMIT
  const reader = Bun.file(filePath).stream().getReader()
  const decoder = new TextDecoder("utf-8")
  const lines: string[] = []
  let pending = ""
  let discard = false
  let count = 0
  let bytes = 0
  let cut = false
  let more = false
  let done = false

  const append = (input: string) => {
    if (done) return
    count += 1
    if (count < offset) return
    if (lines.length >= limit) {
      more = true
      return
    }

    const line = input.length > MAX_LINE_LENGTH ? input.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : input
    const size = Buffer.byteLength(line, "utf-8") + (lines.length > 0 ? 1 : 0)
    if (bytes + size <= MAX_BYTES) {
      lines.push(line)
      bytes += size
      return
    }

    cut = true
    more = true
    done = true
  }

  const consume = (input: string) => {
    let text = input
    while (true) {
      const index = text.indexOf("\n")
      if (index === -1) {
        if (!discard) {
          pending += text
          if (pending.length > MAX_LINE_LENGTH) {
            pending = pending.slice(0, MAX_LINE_LENGTH + 1)
            discard = true
          }
        }
        return
      }

      const current = pending + (discard ? "" : text.slice(0, index))
      pending = ""
      discard = false
      text = text.slice(index + 1)
      append(current.endsWith("\r") ? current.slice(0, -1) : current)
      if (done) return
    }
  }

  while (!done) {
    const next = await reader.read()
    if (next.done) break
    if (next.value.includes(0)) throw new Error(`Cannot read binary file: ${filePath}`)
    consume(decoder.decode(next.value, { stream: true }))
  }

  if (!done) {
    const tail = decoder.decode()
    if (!discard) pending += tail
    if (pending) append(pending.endsWith("\r") ? pending.slice(0, -1) : pending)
  }

  if (count < offset && !(count === 0 && offset === 1)) {
    throw new Error(`Offset ${offset} is out of range for this file (${count} lines)`)
  }

  const last = offset + lines.length - 1
  const next = last + 1
  let output = [`<path>${filePath}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
  output += lines.map((line, index) => `${index + offset}: ${line}`).join("\n")
  if (cut) {
    output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${last}. Use offset=${next} to continue.)`
  } else if (more) {
    output += `\n\n(Showing lines ${offset}-${last} of ${count}. Use offset=${next} to continue.)`
  } else {
    output += `\n\n(End of file - total ${count} lines)`
  }
  output += "\n</content>"
  return output
}

function formatRemoteTextFile(filePath: string, content: string, page?: { offset?: number; limit?: number }) {
  const offset = page?.offset ?? 1
  const limit = page?.limit ?? DEFAULT_READ_LIMIT
  const lines = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
  if (lines.at(-1) === "") lines.pop()
  if (lines.length < offset && !(lines.length === 0 && offset === 1)) {
    throw new Error(`Offset ${offset} is out of range for this file (${lines.length} lines)`)
  }

  const out: string[] = []
  let bytes = 0
  let cut = false
  for (const line of lines.slice(offset - 1, offset - 1 + limit)) {
    const next = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : line
    const size = Buffer.byteLength(next, "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > MAX_BYTES) {
      cut = true
      break
    }
    out.push(next)
    bytes += size
  }

  const last = offset + out.length - 1
  const next = last + 1
  const more = cut || offset - 1 + out.length < lines.length
  let output = [`<path>${filePath}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
  output += out.map((line, index) => `${index + offset}: ${line}`).join("\n")
  if (cut) {
    output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${last}. Use offset=${next} to continue.)`
  } else if (more) {
    output += `\n\n(Showing lines ${offset}-${last} of ${lines.length}. Use offset=${next} to continue.)`
  } else {
    output += `\n\n(End of file - total ${lines.length} lines)`
  }
  output += "\n</content>"
  return output
}

function fileApiPath(directory: string | undefined, filePath: string) {
  if (!directory || !path.isAbsolute(filePath)) return filePath
  const relative = path.relative(directory, filePath)
  if (!relative) return "."
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return relative
  return filePath
}

async function readRemoteDirectory(input: StreamInput, filePath: string, page?: { offset?: number; limit?: number }) {
  const response = await input.sdk.file.list({ directory: input.directory, path: fileApiPath(input.directory, filePath) })
  if (response.error) throw new Error(formatUnknownError(response.error))
  const entries = (response.data ?? [])
    .map((entry) => (entry.type === "directory" ? entry.name + "/" : entry.name))
    .sort((a, b) => a.localeCompare(b))
  const offset = page?.offset ?? 1
  const limit = page?.limit ?? DEFAULT_READ_LIMIT
  const start = offset - 1
  const sliced = entries.slice(start, start + limit)
  const truncated = start + sliced.length < entries.length
  return [
    `<path>${filePath}</path>`,
    `<type>directory</type>`,
    `<entries>`,
    sliced.join("\n"),
    truncated
      ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
      : `\n(${entries.length} entries)`,
    `</entries>`,
  ].join("\n")
}

async function readRemoteFile(input: StreamInput, part: PromptFilePart, filePath: string, page?: { offset?: number; limit?: number }) {
  const response = await input.sdk.file.read({ directory: input.directory, path: fileApiPath(input.directory, filePath) })
  if (response.error) throw new Error(formatUnknownError(response.error))
  const data = response.data
  if (!data) throw new Error(`File not found: ${filePath}`)
  if (data.type === "binary") {
    const mime = data.mimeType ?? FSUtil.mimeType(filePath)
    if (isImageAttachment(mime) || isPdfAttachment(mime)) {
      return {
        text: [readCall(filePath)],
        attachment: {
          uri: `data:${mime};base64,${data.content}`,
          mime,
          name: part.filename,
          source: promptFileSource(part),
        },
      }
    }
    throw new Error(`Cannot read binary file: ${filePath}`)
  }
  return { text: [readCall(filePath, page), formatRemoteTextFile(filePath, data.content, page)] }
}

async function prepareRemotePromptFilePart(input: StreamInput, part: PromptFilePart, filePath: string, page?: { offset?: number; limit?: number }) {
  const source = promptFileSource(part)
  try {
    const prepared =
      part.mime === "application/x-directory"
        ? { text: [readCall(filePath, page), await readRemoteDirectory(input, filePath, page)] }
        : await readRemoteFile(input, part, filePath, page)
    return prepared
  } catch (error) {
    return {
      text: [readFailure(filePath, error instanceof Error ? error.message : String(error))],
    }
  }
}

async function preparePromptFilePart(input: StreamInput, part: PromptFilePart) {
  const source = promptFileSource(part)
  const decoded = decodeTextDataUrl(part.url)
  if (decoded !== undefined) {
    return { text: [readCall(part.filename ?? part.url), decoded] }
  }
  if (isResourcePromptFile(part) || !URL.canParse(part.url) || new URL(part.url).protocol !== "file:") {
    return { attachment: { uri: part.url, mime: part.mime, name: part.filename, source } }
  }

  const url = new URL(part.url)
  const page = promptFilePage(url)
  url.hash = ""
  url.search = ""
  const filePath = fileURLToPath(url)
  if (input.localFilesystem === false) return prepareRemotePromptFilePart(input, part, filePath, page)

  try {
    if ((await stat(filePath)).isDirectory()) {
      return {
        text: [readCall(filePath, page), await readLocalDirectory(filePath, page)],
      }
    }

    const sample = await sampleFile(filePath)
    const mime = sniffAttachmentMime(sample, FSUtil.mimeType(filePath))
    if (isImageAttachment(mime) || isPdfAttachment(mime)) {
      const bytes = await Bun.file(filePath).arrayBuffer()
      return {
        text: [readCall(filePath)],
        attachment: {
          uri: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
          mime,
          name: part.filename,
          source,
        },
      }
    }
    if (isBinaryContent(sample)) {
      throw new Error(`Cannot read binary file: ${filePath}`)
    }

    return {
      text: [readCall(filePath, page), await readLocalTextFile(filePath, page)],
    }
  } catch (error) {
    return {
      text: [readFailure(filePath, error instanceof Error ? error.message : String(error))],
    }
  }
}

async function resolveSelectedModel(input: StreamInput, next: Pick<SessionTurnInput, "model" | "variant" | "signal">) {
  if (next.model) return { providerID: next.model.providerID, id: next.model.modelID, variant: next.variant }
  if (!next.variant) return

  const session = await input.sdk.v2.session
    .get({ sessionID: input.sessionID }, { throwOnError: true, signal: next.signal })
    .then((response) => response.data.data.model)
  if (session) return { ...session, variant: next.variant }

  const config = await input.sdk.config.get(undefined, { throwOnError: true, signal: next.signal })
  if (config.data?.model) {
    const [providerID, ...modelID] = config.data.model.split("/")
    return { providerID, id: modelID.join("/"), variant: next.variant }
  }

  const listed = await input.sdk.v2.model.list(undefined, { throwOnError: true, signal: next.signal })
  const fallback = listed.data.data[0]
  if (!fallback) return
  return { providerID: fallback.providerID, id: fallback.id, variant: next.variant }
}

export async function createSessionTransport(input: StreamInput): Promise<SessionTransport> {
  const controller = new AbortController()
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true })
  const state: State = {
    permissions: [],
    questions: [],
    view: { type: "prompt" },
    messageIDs: new Set(),
    text: new Map(),
    projectedText: new Map(),
    reasoning: new Map(),
    projectedReasoning: new Map(),
    tools: new Map(),
    finishedTools: new Set(),
    connected: false,
    closed: false,
    initial: true,
    errors: new Set(),
  }
  let readyResolve!: () => void
  let readyReject!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const abortReady = () => readyReject(new Error("Mini closed before the event stream connected"))
  controller.signal.addEventListener("abort", abortReady, { once: true })
  const offFooterClose = input.footer.onClose(() => controller.abort())

  const write = (commits: StreamCommit[], patch?: { phase?: "idle" | "running"; status?: string; usage?: string }) => {
    const visible = commits.at(-1)
    if (visible) {
      state.wait?.onVisibleOutput?.({
        kind: visible.kind,
        text: visible.text,
        phase: visible.phase,
        messageID: visible.messageID,
        partID: visible.partID,
        toolState: visible.toolState,
      })
    }
    writeSessionOutput({ footer: input.footer, trace: input.trace }, { commits, footer: patch ? { patch } : undefined })
  }

  const syncBlockers = () => {
    const next = pickBlockerView({ permission: state.permissions[0], question: state.questions[0] })
    if (next.type === "prompt" && state.view.type === "prompt") return
    if (next.type !== "prompt" && state.view.type === next.type && next.request.id === state.view.request.id) return
    state.view = next
    writeSessionOutput(
      { footer: input.footer, trace: input.trace },
      { commits: [], footer: { view: next, patch: { status: blockerStatus(next) } } },
    )
  }

  const renderTool = (messageID: string, item: SessionMessageAssistantTool) => {
    const part = legacyTool({
      sessionID: input.sessionID,
      messageID,
      callID: item.id,
      name: item.name,
      state: item.state,
      time: item.time,
      provider: item.provider,
    })
    if (item.state.status === "pending") return
    if (item.state.status === "running") {
      if (state.tools.get(item.id)?.running) return
      state.tools.set(item.id, {
        messageID,
        name: item.name,
        input: item.state.input,
        started: item.time.ran ?? item.time.created,
        running: true,
      })
      write([toolCommit(part, "start")], { phase: "running", status: `running ${item.name}` })
      return
    }
    if (state.finishedTools.has(item.id)) return
    if (!state.tools.get(item.id)?.running) write([toolCommit(part, "start")])
    state.finishedTools.add(item.id)
    state.tools.delete(item.id)
    write([toolCommit(part, item.state.status === "completed" && part.state.status === "completed" && part.state.output ? "progress" : "final")])
  }

  const renderMessage = (message: SessionMessage, render: boolean, reuseVisibleWait: boolean) => {
    if (message.type === "user") {
      const waiting = state.wait?.messageID === message.id
      if (waiting && state.wait) state.wait.promoted = true
      if (!render || state.messageIDs.has(message.id)) return
      state.messageIDs.add(message.id)
      if (reuseVisibleWait && waiting) return
      write([{ kind: "user", source: "system", text: authoredPromptText(message.text), phase: "start", messageID: message.id }])
      return
    }
    if (message.type !== "assistant") return
    state.messageIDs.add(message.id)
    for (const item of message.content) {
      if (item.type === "text") {
        const key = streamPartKey(message.id, item.id)
        const sent = state.text.get(key)?.length ?? 0
        state.text.set(key, item.text)
        if (render) state.projectedText.set(key, item.text)
        if (render && item.text.length > sent)
          write([
            {
              kind: "assistant",
              source: "assistant",
              text: item.text.slice(sent),
              phase: "progress",
              messageID: message.id,
              partID: item.id,
            },
          ])
        continue
      }
      if (item.type === "reasoning") {
        const key = streamPartKey(message.id, item.id)
        const sent = state.reasoning.get(key)?.length ?? 0
        state.reasoning.set(key, item.text)
        if (render) state.projectedReasoning.set(key, item.text)
        if (render && input.thinking && item.text.length > sent)
          write([
            {
              kind: "reasoning",
              source: "reasoning",
              text: sent === 0 ? `Thinking: ${item.text}` : item.text.slice(sent),
              phase: "progress",
              messageID: message.id,
              partID: item.id,
            },
          ])
        continue
      }
      if (render) renderTool(message.id, item)
    }
    if (render && message.error && !state.errors.has(message.id)) {
      state.errors.add(message.id)
      write([
        {
          kind: "error",
          source: "system",
          text: errorMessage(message.error),
          phase: "start",
          messageID: message.id,
        },
      ])
    }
  }

  const hydrate = async (next: { render: boolean; reuseVisibleWait: boolean }) => {
    const [messages, permissions, questions, active] = await Promise.all([
      input.sdk.v2.session.messages(
        { sessionID: input.sessionID, limit: input.replayLimit ?? 200, order: "desc" },
        { throwOnError: true },
      ),
      input.sdk.v2.session.permission.list({ sessionID: input.sessionID }, { throwOnError: true }),
      input.sdk.v2.session.question.list({ sessionID: input.sessionID }, { throwOnError: true }),
      input.sdk.v2.session.active({ throwOnError: true }),
    ])
    for (const message of messages.data.data.toReversed()) renderMessage(message, next.render, next.reuseVisibleWait)
    state.permissions = permissions.data.data.map(permission)
    state.questions = questions.data.data.map(question)
    syncBlockers()
    const running = input.sessionID in active.data.data
    write([], { phase: running ? "running" : "idle", status: running ? "assistant responding" : "" })
    if (!running && state.wait && (state.wait.promoted || state.wait.interrupted)) {
      const current = state.wait
      state.wait = undefined
      current.resolve()
    }
  }

  const apply = (event: RunV2Event) => {
    if (sessionID(event) !== input.sessionID) return
    input.trace?.write("recv.event", event)
    if (event.type === "session.next.prompted") {
      if (state.wait?.messageID === event.data.messageID) state.wait.promoted = true
      state.messageIDs.add(event.data.messageID)
      write([], { phase: "running", status: "waiting for assistant" })
      return
    }
    if (event.type === "session.next.step.started") {
      write([], { phase: "running", status: "assistant responding" })
      return
    }
    if (event.type === "session.next.text.delta") {
      const key = streamPartKey(event.data.assistantMessageID, event.data.textID)
      const projected = state.projectedText.get(key)
      const covered = projected?.indexOf(event.data.delta) ?? -1
      if (projected && covered >= 0) {
        state.projectedText.set(key, projected.slice(covered + event.data.delta.length))
        return
      }
      const previous = state.text.get(key) ?? ""
      state.text.set(key, previous + event.data.delta)
      write([
        {
          kind: "assistant",
          source: "assistant",
          text: event.data.delta,
          phase: "progress",
          messageID: event.data.assistantMessageID,
          partID: event.data.textID,
        },
      ])
      return
    }
    if (event.type === "session.next.text.ended") {
      const key = streamPartKey(event.data.assistantMessageID, event.data.textID)
      const previous = state.text.get(key) ?? ""
      if (event.data.text.length > previous.length)
        write([
          {
            kind: "assistant",
            source: "assistant",
            text: event.data.text.slice(previous.length),
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: event.data.textID,
          },
        ])
      state.text.set(key, event.data.text)
      state.projectedText.delete(key)
      return
    }
    if (event.type === "session.next.reasoning.delta") {
      const key = streamPartKey(event.data.assistantMessageID, event.data.reasoningID)
      const projected = state.projectedReasoning.get(key)
      const covered = projected?.indexOf(event.data.delta) ?? -1
      if (projected && covered >= 0) {
        state.projectedReasoning.set(key, projected.slice(covered + event.data.delta.length))
        return
      }
      const previous = state.reasoning.get(key) ?? ""
      state.reasoning.set(key, previous + event.data.delta)
      if (input.thinking)
        write([
          {
            kind: "reasoning",
            source: "reasoning",
            text: previous ? event.data.delta : `Thinking: ${event.data.delta}`,
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: event.data.reasoningID,
          },
        ])
      return
    }
    if (event.type === "session.next.reasoning.ended") {
      const key = streamPartKey(event.data.assistantMessageID, event.data.reasoningID)
      const previous = state.reasoning.get(key) ?? ""
      if (input.thinking && event.data.text.length > previous.length)
        write([
          {
            kind: "reasoning",
            source: "reasoning",
            text: previous ? event.data.text.slice(previous.length) : `Thinking: ${event.data.text}`,
            phase: "progress",
            messageID: event.data.assistantMessageID,
            partID: event.data.reasoningID,
          },
        ])
      state.reasoning.set(key, event.data.text)
      state.projectedReasoning.delete(key)
      return
    }
    if (event.type === "session.next.tool.input.started") {
      state.tools.set(event.data.callID, {
        messageID: event.data.assistantMessageID,
        name: event.data.name,
        input: {},
        started: event.data.timestamp,
        running: false,
      })
      return
    }
    if (event.type === "session.next.tool.called") {
      if (state.finishedTools.has(event.data.callID)) return
      const current = state.tools.get(event.data.callID)
      const item: SessionMessageAssistantTool = {
        type: "tool",
        id: event.data.callID,
        name: event.data.tool,
        provider: event.data.provider,
        state: { status: "running", input: event.data.input, structured: {}, content: [] },
        time: { created: current?.started ?? event.data.timestamp, ran: event.data.timestamp },
      }
      renderTool(event.data.assistantMessageID, item)
      return
    }
    if (event.type === "session.next.tool.progress") return
    if (event.type === "session.next.tool.success" || event.type === "session.next.tool.failed") {
      const current = state.tools.get(event.data.callID)
      const failed = event.type === "session.next.tool.failed"
      const item: SessionMessageAssistantTool = {
        type: "tool",
        id: event.data.callID,
        name: current?.name ?? "tool",
        provider: event.data.provider,
        state: failed
          ? { status: "error", input: current?.input ?? {}, structured: {}, content: [], error: event.data.error, result: event.data.result }
          : {
              status: "completed",
              input: current?.input ?? {},
              structured: event.data.structured,
              content: event.data.content,
              outputPaths: event.data.outputPaths,
              result: event.data.result,
            },
        time: { created: current?.started ?? event.data.timestamp, ran: current?.started, completed: event.data.timestamp },
      }
      renderTool(event.data.assistantMessageID, item)
      return
    }
    if (event.type === "permission.v2.asked") {
      if (!state.permissions.some((item) => item.id === event.data.id)) state.permissions.push(permission(event.data))
      syncBlockers()
      return
    }
    if (event.type === "permission.v2.replied") {
      state.permissions = state.permissions.filter((item) => item.id !== event.data.requestID)
      syncBlockers()
      return
    }
    if (event.type === "question.v2.asked") {
      if (!state.questions.some((item) => item.id === event.data.id)) state.questions.push(question(event.data))
      syncBlockers()
      return
    }
    if (event.type === "question.v2.replied" || event.type === "question.v2.rejected") {
      state.questions = state.questions.filter((item) => item.id !== event.data.requestID)
      syncBlockers()
      return
    }
    if (event.type === "session.next.step.ended") {
      const total =
        event.data.tokens.input +
        event.data.tokens.output +
        event.data.tokens.reasoning +
        event.data.tokens.cache.read +
        event.data.tokens.cache.write
      const usage = total > 0 ? total.toLocaleString() : ""
      write([], { phase: event.data.finish === "tool-calls" ? "running" : "idle", usage: event.data.cost ? `${usage} · ${money.format(event.data.cost)}` : usage })
      return
    }
    if (event.type === "session.next.step.failed") {
      state.errors.add(event.data.assistantMessageID)
      if (state.wait) state.wait.failureRendered = true
      write([{ kind: "error", source: "system", text: errorMessage(event.data.error), phase: "start" }])
      return
    }
    if (event.type === "session.next.execution.settled") {
      write([], { phase: "idle", status: "" })
      const current = state.wait
      if (!current || (!current.promoted && !current.interrupted)) return
      state.wait = undefined
      if (current.interrupted) {
        current.resolve()
        return
      }
      if (event.data.outcome === "failure") {
        if (current.failureRendered) {
          current.resolve()
          return
        }
        current.reject(new Error(event.data.error ? errorMessage(event.data.error) : "Session execution failed"))
        return
      }
      current.resolve()
    }
  }

  const receive = (event: RunV2Event) => {
    if (state.buffered) {
      state.buffered.push(event)
      return
    }
    apply(event)
  }

  const connect = async () => {
    while (!controller.signal.aborted && !input.footer.isClosed) {
      const error = await (async () => {
        const connection = new AbortController()
        const abortConnection = () => connection.abort()
        controller.signal.addEventListener("abort", abortConnection, { once: true })
        const response = await input.sdk.v2.event.subscribe({
          signal: connection.signal,
          sseMaxRetryAttempts: 0,
          throwOnError: true,
        })
          const stream = response.stream[Symbol.asyncIterator]() as AsyncGenerator<RunV2Event>
        try {
          const first = await stream.next()
          if (first.done || first.value.type !== "server.connected") throw new Error("Event stream disconnected")
          const buffered: RunV2Event[] = []
          let booting = true
          const consume = (async () => {
            while (!connection.signal.aborted) {
              const next = await stream.next()
              if (next.done) throw new Error("Event stream disconnected")
              if (booting) buffered.push(next.value)
              else receive(next.value)
            }
          })()
          void consume.catch(() => {})
          await hydrate({ render: state.initial ? input.replay === true : true, reuseVisibleWait: !state.initial })
          state.initial = false
          booting = false
          for (const event of buffered.splice(0)) apply(event)
          state.connected = true
          readyResolve()
          await consume
        } finally {
          controller.signal.removeEventListener("abort", abortConnection)
          connection.abort()
          void stream.return?.(undefined).catch(() => {})
        }
      })().catch((error) => error)
      state.connected = false
      if (controller.signal.aborted || input.footer.isClosed) return
      input.trace?.write("recv.reconnect", { error: formatUnknownError(error) })
      write([], { phase: "running", status: "reconnecting" })
      await wait(250, controller.signal)
    }
  }
  const connection = connect()
  try {
    await ready
  } catch (error) {
    offFooterClose()
    throw error
  } finally {
    controller.signal.removeEventListener("abort", abortReady)
  }

  return {
    async runPromptTurn(next) {
      if (next.prompt.mode === "shell") throw new Error("Shell is not yet available for current Session transcripts")
      if (next.prompt.command) throw new Error("Commands are not yet available for current Session transcripts")
      if (state.wait) throw new Error("prompt already running")
      if (!state.connected) throw new Error("Event stream is reconnecting")

      if (next.agent) {
        await input.sdk.v2.session.switchAgent(
          { sessionID: input.sessionID, agent: next.agent },
          { throwOnError: true, signal: next.signal },
        )
      }
      const selected = await resolveSelectedModel(input, next)
      if (next.variant && !selected) throw new Error("Cannot select a variant before selecting a model")
      if (selected)
        await input.sdk.v2.session.switchModel(
          { sessionID: input.sessionID, model: selected },
          { throwOnError: true, signal: next.signal },
        )

      const prepared = await Promise.all((next.includeFiles ? next.files : []).map(prepareFile))
      const promptFiles = await Promise.all(
        next.prompt.parts.flatMap((part) => (part.type === "file" ? [preparePromptFilePart(input, part)] : [])),
      )
      const attachments = [
        ...prepared.flatMap((file) => (file.attachment ? [file.attachment] : [])),
        ...promptFiles.flatMap((file) => (file.attachment ? [file.attachment] : [])),
      ]
      const agents = next.prompt.parts.flatMap((part) =>
        part.type === "agent"
          ? [
              {
                name: part.name,
                source: part.source
                  ? { start: part.source.start, end: part.source.end, text: part.source.value }
                  : undefined,
              },
            ]
          : [],
      )
      const messageID = next.prompt.messageID
      if (!messageID) throw new Error("Prompt message ID is required")
      let resolve!: () => void
      let reject!: (error: unknown) => void
      const done = new Promise<void>((done, fail) => {
        resolve = done
        reject = fail
      })
      const active: Wait = {
        messageID,
        promoted: false,
        interrupted: false,
        failureRendered: false,
        resolve,
        reject,
        onVisibleOutput: next.onVisibleOutput,
      }
      state.wait = active
      const interrupt = () => {
        active.interrupted = true
        void input.sdk.v2.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
      }
      next.signal?.addEventListener("abort", interrupt, { once: true })
      try {
        input.trace?.write("send.prompt", { sessionID: input.sessionID, messageID })
        await input.sdk.v2.session.prompt(
          {
            sessionID: input.sessionID,
            id: messageID,
            prompt: {
              text: [
                next.prompt.text,
                ...prepared.flatMap((file) => (file.text ? [file.text] : [])),
                ...promptFiles.flatMap((file) => ("text" in file ? file.text : [])),
              ].join("\n\n"),
              files: attachments.length ? attachments : undefined,
              agents: agents.length ? agents : undefined,
            },
            delivery: "steer",
          },
          { throwOnError: true, signal: next.signal },
        )
        await done
      } catch (error) {
        if (state.wait === active) state.wait = undefined
        if (next.signal?.aborted) return
        throw error
      } finally {
        next.signal?.removeEventListener("abort", interrupt)
      }
    },
    async interruptActiveTurn() {
      if (state.wait) state.wait.interrupted = true
      await input.sdk.v2.session.interrupt({ sessionID: input.sessionID }).catch(() => {})
    },
    selectSubagent() {},
    async replayOnResize(next) {
      if (!input.replay || state.closed || input.footer.isClosed) return false
      const buffered: RunV2Event[] = []
      state.buffered = buffered
      try {
        await input.footer.idle()
        await next.reset()
        state.messageIDs.clear()
        state.text.clear()
        state.projectedText.clear()
        state.reasoning.clear()
        state.projectedReasoning.clear()
        state.tools.clear()
        state.finishedTools.clear()
        state.errors.clear()
        await hydrate({ render: true, reuseVisibleWait: false })
      } finally {
        state.buffered = undefined
      }
      for (const event of buffered) apply(event)
      for (const row of next.localRows()) {
        if (row.commit.messageID && state.messageIDs.has(row.commit.messageID)) continue
        input.footer.append(row.commit)
      }
      return true
    },
    async close() {
      state.closed = true
      offFooterClose()
      controller.abort()
      void connection.catch(() => {})
    },
  }
}
