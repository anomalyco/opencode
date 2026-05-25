import { Hono } from "hono"
import { stream, streamSSE } from "hono/streaming"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import os from "node:os"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Global } from "@opencode-ai/core/global"
import { Log } from "@opencode-ai/core/util/log"
import { Identifier } from "@/id/id"
import { NamedError } from "@opencode-ai/core/util/error"

type Opts = {
  hostname: string
  port: number
  cors?: string[]
  gateway: {
    url: string
    token?: string
  }
}

const fileUnsupported =
  "OpenClaw does not expose a project filesystem yet. Use a normal project to browse files, or keep chatting in OpenClaw without the file tree."

function gatewayError(error: unknown, action: string) {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`OpenClaw gateway ${action} failed: ${message}`)
}

type GwSession = {
  key?: string
  id?: string
  label?: string
  displayName?: string
  derivedTitle?: string
  updatedAt?: number | string
  createdAt?: number | string
}

type GwHistory = {
  messages?: GwMessage[]
}

type PromptBody = {
  messageID?: string
  parts?: Array<{ type?: string; text?: string }>
}

type GwMessage = {
  role?: string
  content?: unknown
  timestamp?: number | string
  ts?: number | string
  model?: string
  provider?: string
}

type GwResponse = {
  id?: string
  ok?: boolean
  payload?: unknown
  error?: {
    message?: string
  }
}

type GwEvent = {
  event?: string
  payload?: Record<string, unknown>
}

type Device = {
  deviceID: string
  publicKey: string
  privateKey: string
}

type Session = {
  id: string
  slug: string
  projectID: string
  directory: string
  title: string
  version: string
  time: {
    created: number
    updated: number
  }
}

type Message = {
  info: {
    id: string
    sessionID: string
    role: "user" | "assistant"
    time: {
      created: number
      completed?: number
    }
    agent: string
    model?: {
      providerID: string
      modelID: string
    }
    parentID?: string
    providerID?: string
    modelID?: string
    mode?: string
    path?: {
      cwd: string
      root: string
    }
    cost?: number
    tokens?: {
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
  }
  parts: Part[]
}

type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
}

type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state:
    | {
        status: "pending"
        input: Record<string, unknown>
        raw: string
      }
    | {
        status: "running"
        input: Record<string, unknown>
        title?: string
        metadata?: Record<string, unknown>
        time: {
          start: number
        }
      }
    | {
        status: "completed"
        input: Record<string, unknown>
        output: string
        title: string
        metadata: Record<string, unknown>
        time: {
          start: number
          end: number
          compacted?: number
        }
      }
    | {
        status: "error"
        input: Record<string, unknown>
        error: string
        metadata?: Record<string, unknown>
        time: {
          start: number
          end: number
        }
      }
}

type Part = TextPart | ToolPart

type Event = {
  directory: string
  payload: {
    type: string
    properties: Record<string, unknown>
  }
}

const projectID = "openclaw"
const version = "openclaw-bridge"
const directory = "/openclaw"
const log = Log.create({ service: "openclaw-bridge" })
const clientID = "gateway-client"

function now(input?: number | string) {
  if (typeof input === "number") return input
  if (typeof input === "string") {
    const n = Date.parse(input)
    if (!Number.isNaN(n)) return n
    const m = Number(input)
    if (!Number.isNaN(m)) return m
  }
  return Date.now()
}

function id(input: GwSession) {
  return input.key || input.id || crypto.randomUUID()
}

function text(input: unknown): string {
  if (typeof input === "string") return input
  if (Array.isArray(input)) return input.map(text).filter(Boolean).join("\n")
  if (!input || typeof input !== "object") return ""
  if ("text" in input && typeof input.text === "string") return input.text
  if ("content" in input) return text(input.content)
  return ""
}

function record(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function list(input: unknown) {
  return Array.isArray(input) ? input : []
}

function stringify(input: unknown): string {
  const body = text(input)
  if (body) return body
  if (typeof input === "string") return input
  if (input === undefined || input === null) return ""
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function preview(input: unknown, size = 240) {
  const body = stringify(input).replace(/\s+/g, " ").trim()
  if (body.length <= size) return body
  return body.slice(0, size) + "..."
}

function shape(input: unknown) {
  if (Array.isArray(input)) {
    return input.map((item) => {
      const part = record(item)
      if (!part) return typeof item
      return {
        type: typeof part.type === "string" ? part.type : undefined,
        id: typeof part.id === "string" ? part.id : undefined,
        call_id: typeof part.call_id === "string" ? part.call_id : undefined,
        tool_use_id: typeof part.tool_use_id === "string" ? part.tool_use_id : undefined,
        name: typeof part.name === "string" ? part.name : undefined,
        keys: Object.keys(part),
      }
    })
  }
  const part = record(input)
  if (!part) return typeof input
  return {
    keys: Object.keys(part),
    role: typeof part.role === "string" ? part.role : undefined,
    type: typeof part.type === "string" ? part.type : undefined,
  }
}

function payload(input: unknown) {
  if (Array.isArray(input)) return input
  const item = record(input)
  if (!item) return []
  if (Array.isArray(item.content)) return item.content
  if (record(item.content)) return [item.content]
  if (typeof item.type === "string") return [item]
  return []
}

function parseArgs(input: unknown) {
  if (!input) return {}
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input)
      return record(parsed) ?? { value: parsed }
    } catch {
      return { value: input }
    }
  }
  return record(input) ?? { value: input }
}

function textPart(sessionID: string, messageID: string, id: string, body: string): TextPart {
  return {
    id,
    sessionID,
    messageID,
    type: "text",
    text: body,
  }
}

function toolTitle(tool: string) {
  return tool
    .split(/[_-]/g)
    .filter(Boolean)
    .map((item) => item[0]?.toUpperCase() + item.slice(1))
    .join(" ")
}

function inputText(parts: Part[]) {
  return parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function started(part: ToolPart, time: number) {
  if (part.state.status === "running") return part.state.time.start
  if (part.state.status === "completed") return part.state.time.start
  if (part.state.status === "error") return part.state.time.start
  return time
}

function title(part: ToolPart) {
  if (part.state.status === "running" && part.state.title) return part.state.title
  if (part.state.status === "completed") return part.state.title
  return toolTitle(part.tool)
}

function toolCalls(item: GwMessage, messageID: string, sessionID: string, time: number) {
  const root = record(item) ?? {}
  const blocks = payload(item.content)
  const direct = list(root.tool_calls)
  const result: ToolPart[] = []
  let n = 0

  const push = (callID: string, tool: string, input: Record<string, unknown>, metadata?: Record<string, unknown>) => {
    result.push({
      id: `${messageID}-p${n++}`,
      sessionID,
      messageID,
      type: "tool",
      callID,
      tool,
      state: {
        status: "running",
        input,
        title: toolTitle(tool),
        ...(metadata ? { metadata } : {}),
        time: { start: time },
      },
    })
  }

  for (const block of blocks) {
    const part = record(block)
    if (!part) continue
    const type = typeof part.type === "string" ? part.type : ""
    if (type !== "tool_use" && type !== "function_call" && type !== "toolCall") continue
    const callID =
      typeof part.id === "string"
        ? part.id
        : typeof part.call_id === "string"
          ? part.call_id
          : typeof part.callID === "string"
            ? part.callID
            : `${messageID}-call-${n}`
    const tool =
      typeof part.name === "string"
        ? part.name
        : record(part.function) && typeof record(part.function)?.name === "string"
          ? String(record(part.function)?.name)
          : "tool"
    const args =
      "input" in part
        ? parseArgs(part.input)
        : "arguments" in part
          ? parseArgs(part.arguments)
          : record(part.function) && "arguments" in (record(part.function) ?? {})
            ? parseArgs(record(part.function)?.arguments)
            : {}
    push(callID, tool, args, record(part.metadata))
  }

  for (const block of direct) {
    const part = record(block)
    if (!part) continue
    const fn = record(part.function)
    if (typeof fn?.name !== "string") continue
    const callID = typeof part.id === "string" ? part.id : `${messageID}-call-${n}`
    push(callID, fn.name, parseArgs(fn.arguments), record(part.metadata))
  }

  if (result.length === 0 && (blocks.length > 0 || direct.length > 0)) {
    log.warn("openclaw tool call parse miss", {
      sessionID,
      messageID,
      contentShape: shape(item.content),
      directToolCalls: shape(direct),
    })
  }

  return result
}

function toolResults(item: GwMessage) {
  const root = record(item) ?? {}
  const body = payload(item.content)
  const rootCall =
    typeof root.tool_use_id === "string" ||
    typeof root.toolUseId === "string" ||
    typeof root.call_id === "string" ||
    typeof root.callId === "string" ||
    typeof root.toolCallId === "string"
  const blocks = [...(rootCall ? [root] : []), ...(body.length > 0 ? body : list(root.content))]
  const result = blocks
    .map((block) => {
      const part = record(block)
      if (!part) return
      const type =
        typeof part.type === "string" ? part.type : part === root && item.role === "toolResult" ? "toolResult" : ""
      if (
        type !== "tool_result" &&
        type !== "function_call_output" &&
        type !== "toolResult" &&
        type !== "functionCallOutput"
      )
        return
      const callID =
        typeof part.tool_use_id === "string"
          ? part.tool_use_id
          : typeof part.toolUseId === "string"
            ? part.toolUseId
            : typeof part.call_id === "string"
              ? part.call_id
              : typeof part.callId === "string"
                ? part.callId
                : typeof part.toolCallId === "string"
                  ? part.toolCallId
                  : undefined
      if (!callID) return
      const body =
        type === "tool_result" || type === "toolResult"
          ? stringify("content" in part ? part.content : "output" in part ? part.output : part.result)
          : stringify("output" in part ? part.output : part.result)
      const failed =
        part.is_error === true ||
        part.isError === true ||
        part.error === true ||
        (typeof part.status === "string" && ["error", "failed"].includes(part.status)) ||
        (typeof record(part.details)?.status === "string" &&
          ["error", "failed"].includes(String(record(part.details)?.status)))
      return {
        callID,
        output: body,
        failed,
        metadata: record(part.metadata),
      }
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
  return result
}

function assistantParts(item: GwMessage, messageID: string, sessionID: string) {
  const blocks = payload(item.content)
  const parts: Part[] = []
  let n = 0

  for (const block of blocks) {
    const part = record(block)
    if (!part) continue
    if (part.type === "text" && typeof part.text === "string" && part.text) {
      parts.push(textPart(sessionID, messageID, `${messageID}-p${n++}`, part.text))
    }
  }

  const calls = toolCalls(item, messageID, sessionID, now(item.timestamp ?? item.ts))
  for (const call of calls) {
    parts.push({
      ...call,
      id: `${messageID}-p${n++}`,
    })
  }

  if (parts.length > 0) return parts
  const body = text(item.content)
  if (!body) return []
  return [textPart(sessionID, messageID, `${messageID}-p0`, body)]
}

function userParts(item: GwMessage, messageID: string, sessionID: string) {
  const blocks = payload(item.content)
  const parts: TextPart[] = []
  let n = 0
  for (const block of blocks) {
    const part = record(block)
    if (!part) continue
    if (typeof part.type === "string" && part.type !== "text") continue
    if (typeof part.text !== "string" || !part.text) continue
    parts.push(textPart(sessionID, messageID, `${messageID}-p${n++}`, part.text))
  }
  if (parts.length > 0) return parts
  if (blocks.length > 0) return []
  const body = text(item.content)
  if (!body) return []
  return [textPart(sessionID, messageID, `${messageID}-p0`, body)]
}

function applyToolResult(message: Message, result: ReturnType<typeof toolResults>[number], time: number) {
  let hit = false
  message.parts = message.parts.map((part) => {
    if (part.type !== "tool") return part
    if (part.callID !== result.callID) return part
    hit = true
    if (result.failed) {
      return {
        ...part,
        state: {
          status: "error",
          input: part.state.input,
          error: result.output || "Tool call failed",
          ...(result.metadata ? { metadata: result.metadata } : {}),
          time: {
            start: started(part, time),
            end: time,
          },
        },
      }
    }
    return {
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        output: result.output,
        title: title(part),
        metadata: result.metadata ?? {},
        time: {
          start: started(part, time),
          end: time,
        },
      },
    }
  })
  return hit
}

function applyResults(
  messages: Message[],
  sessionID: string,
  results: ReturnType<typeof toolResults>,
  time: number,
  preferred?: Message,
) {
  for (const result of results) {
    let applied = false
    if (preferred?.info.role === "assistant") {
      applied = applyToolResult(preferred, result, time)
    }
    if (!applied) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (!msg || msg === preferred) continue
        if (msg.info.role !== "assistant") continue
        if (applyToolResult(msg, result, time)) {
          applied = true
          break
        }
      }
    }
    if (applied) continue
    log.warn("openclaw tool result unmatched", {
      sessionID,
      callID: result.callID,
      output: preview(result.output),
    })
  }
}

function historyMessages(sessionID: string, input: GwMessage[]) {
  const messages: Message[] = []
  const ids: string[] = []
  let parentID: string | undefined

  for (const item of input) {
    const role =
      item.role === "assistant"
        ? "assistant"
        : item.role === "user"
          ? "user"
          : item.role === "tool" || item.role === "toolResult"
            ? "tool"
            : undefined
    if (!role) continue
    const created = now(item.timestamp ?? item.ts)
    const results = toolResults(item)
    if (results.length > 0) {
      if (role !== "assistant") applyResults(messages, sessionID, results, created)
    }
    if (role === "tool") continue
    const messageID = msgID(sessionID, created, messages.length)
    if (role === "user") {
      const parts = userParts(item, messageID, sessionID)
      if (parts.length === 0) continue
      const next: Message = {
        info: {
          id: messageID,
          sessionID,
          role,
          time: { created },
          agent: "claw",
          model:
            item.provider && item.model ? { providerID: item.provider, modelID: item.model } : { providerID, modelID },
        },
        parts,
      }
      messages.push(next)
      ids.push(next.info.id)
      parentID = next.info.id
      continue
    }
    const parts = assistantParts(item, messageID, sessionID)
    if (parts.length === 0) continue
    const next = {
      info: {
        id: messageID,
        sessionID,
        role,
        time: { created, completed: created },
        parentID: parentID ?? ids[Math.max(0, messages.length - 1)],
        providerID: item.provider || providerID,
        modelID: item.model || modelID,
        mode: "default",
        agent: "claw",
        path: { cwd: `${directory}/${sessionID}`, root: directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts,
    } satisfies Message
    messages.push(next)
    ids.push(next.info.id)
    if (results.length > 0) applyResults(messages, sessionID, results, created, next)
  }

  return messages
}

function partID(messageID: string, callID: string) {
  return `${messageID}-tool-${callID.replace(/[^a-zA-Z0-9_-]/g, "_")}`
}

function streamParts(
  messageID: string,
  sessionID: string,
  input: unknown,
  time: number,
  tools?: Map<string, ToolPart>,
) {
  const item = record(input) as GwMessage | undefined
  if (!item) return { calls: [] as ToolPart[], results: [] as ReturnType<typeof toolResults>, parts: [] as ToolPart[] }
  const calls = toolCalls(item, messageID, sessionID, time)
  const results = toolResults(item)
  const part = new Map<string, ToolPart>()

  for (const call of calls) {
    const current = part.get(call.callID) ?? tools?.get(call.callID)
    // Gateway deltas can replay the same toolCall after its toolResult already
    // arrived. Never downgrade a completed/error tool back to running.
    if (current && current.state.status !== "running") {
      part.set(call.callID, current)
      continue
    }
    const next = {
      ...call,
      id: current?.id ?? partID(messageID, call.callID),
      messageID,
      sessionID,
    } satisfies ToolPart
    part.set(call.callID, next)
  }

  for (const result of results) {
    const current = part.get(result.callID) ?? tools?.get(result.callID)
    const start = current ? started(current, time) : time
    const next = result.failed
      ? {
          id: current?.id ?? partID(messageID, result.callID),
          sessionID,
          messageID,
          type: "tool" as const,
          callID: result.callID,
          tool: current?.tool ?? "tool",
          state: {
            status: "error" as const,
            input: current?.state.input ?? {},
            error: result.output || "Tool call failed",
            ...(result.metadata ? { metadata: result.metadata } : {}),
            time: { start, end: time },
          },
        }
      : {
          id: current?.id ?? partID(messageID, result.callID),
          sessionID,
          messageID,
          type: "tool" as const,
          callID: result.callID,
          tool: current?.tool ?? "tool",
          state: {
            status: "completed" as const,
            input: current?.state.input ?? {},
            output: result.output,
            title: current ? title(current) : "Tool",
            metadata: result.metadata ?? {},
            time: { start, end: time },
          },
        }
    part.set(result.callID, next)
  }

  return {
    calls,
    results,
    parts: [...part.values()],
  }
}

function prompt(input: unknown) {
  if (!Array.isArray(input)) return ""
  return input
    .filter(
      (item): item is { type: "text"; text: string } =>
        !!item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n")
}

function sent(sessionID: string, body: PromptBody) {
  const messageID = body.messageID || Identifier.ascending("message")
  const text = prompt(body.parts)
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "claw",
      model: { providerID, modelID },
    },
    parts: [
      {
        id: `${messageID}-p0`,
        sessionID,
        messageID,
        type: "text",
        text,
      },
    ],
  } satisfies Message
}

function mergeHistory(history: Message[], optimistic: Message[]) {
  if (optimistic.length === 0) return history
  const rest = [...optimistic]
  const matched = history.map((item) => {
    if (item.info.role !== "user") return item
    const text = inputText(item.parts)
    const hit = rest.findIndex((candidate) => {
      if (candidate.info.role !== "user") return false
      const body = inputText(candidate.parts)
      if (body !== text) return false
      return Math.abs(candidate.info.time.created - item.info.time.created) < 60_000
    })
    if (hit === -1) return item
    const [candidate] = rest.splice(hit, 1)
    return {
      ...item,
      info: {
        ...item.info,
        id: candidate.info.id,
      },
      parts: candidate.parts,
    }
  })
  return [...matched, ...rest].sort((a, b) => a.info.time.created - b.info.time.created || cmp(a.info.id, b.info.id))
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

function ord(value: number, width: number) {
  return Math.max(0, Math.trunc(value)).toString().padStart(width, "0")
}

function msgID(sessionID: string, created: number, index: number) {
  return `${sessionID}-m${ord(created, 13)}-${ord(index, 4)}`
}

function session(input: GwSession): Session {
  const sid = id(input)
  return {
    id: sid,
    slug: sid,
    projectID,
    // Keep every OpenClaw session in the synthetic `/openclaw` workspace so the
    // existing sidebar/session UI can list them together like a built-in project.
    directory,
    title: input.label || input.displayName || input.derivedTitle || sid,
    version,
    time: {
      created: now(input.createdAt),
      updated: now(input.updatedAt),
    },
  }
}

const modelID = "claw"
const providerID = "openclaw"

const provider = {
  id: providerID,
  name: "OpenClaw",
  env: [],
  models: {
    [modelID]: {
      id: modelID,
      name: "Claw",
      release_date: "2026-01-01",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      interleaved: false,
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      cost: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
      },
      limit: {
        context: 200000,
        output: 8000,
      },
      status: "active",
      options: {},
      headers: {},
      provider: {
        api: "openai-compatible",
        npm: "@ai-sdk/openai-compatible",
      },
    },
  },
} as const

const agent = {
  name: "claw",
  description: "OpenClaw bridge agent",
  mode: "primary",
  permission: {},
  model: {
    providerID,
    modelID,
  },
  options: {},
} as const

const ed25519Prefix = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])

function base64url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function raw(key: string) {
  const der = createPublicKey(key).export({ format: "der", type: "spki" })
  const buf = Buffer.isBuffer(der) ? der : Buffer.from(der)
  if (buf.subarray(0, ed25519Prefix.length).equals(ed25519Prefix)) return buf.subarray(ed25519Prefix.length)
  return buf
}

async function device() {
  const file = path.join(os.homedir(), ".openclaw", "identity", "device.json")
  const saved = (await Bun.file(file)
    .json()
    .catch(() => undefined)) as
    | {
        deviceId?: string
        publicKeyPem?: string
        privateKeyPem?: string
      }
    | undefined
  if (saved?.deviceId && saved.publicKeyPem && saved.privateKeyPem) {
    log.debug("loaded openclaw device identity", { file, deviceID: saved.deviceId })
    return {
      deviceID: saved.deviceId,
      publicKey: saved.publicKeyPem,
      privateKey: saved.privateKeyPem,
    } satisfies Device
  }
  const pair = generateKeyPairSync("ed25519")
  const publicKey = pair.publicKey.export({ format: "pem", type: "spki" }).toString()
  const privateKey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  const deviceID = createHash("sha256").update(raw(publicKey)).digest("hex")
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    `${JSON.stringify(
      {
        version: 1,
        deviceId: deviceID,
        publicKeyPem: publicKey,
        privateKeyPem: privateKey,
        createdAtMs: Date.now(),
      },
      null,
      2,
    )}\n`,
  )
  log.info("generated openclaw device identity", { file, deviceID })
  return { deviceID, publicKey, privateKey } satisfies Device
}

class GwClient {
  private ws?: WebSocket
  private ready?: Promise<void>
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private events = new Set<(event: GwEvent) => void>()

  constructor(
    private url: string,
    private token?: string,
  ) {}

  private socket() {
    try {
      const url = new URL(this.url)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      if (!url.pathname || url.pathname === "/") return url.toString()
      return url.toString()
    } catch {
      if (this.url.startsWith("ws://") || this.url.startsWith("wss://")) return this.url
      if (this.url.startsWith("https://")) return this.url.replace("https://", "wss://")
      if (this.url.startsWith("http://")) return this.url.replace("http://", "ws://")
      return `ws://${this.url}`
    }
  }

  private async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.ready) return this.ready
    log.info("connecting to openclaw gateway", { url: this.socket(), hasToken: !!this.token })
    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.socket())
      let done = false
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        fn()
      }
      ws.onmessage = (event) => {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>
        if (typeof data.event === "string") {
          const evt = data as GwEvent
          for (const fn of this.events) fn(evt)
        }
        if (data.event === "connect.challenge") {
          log.debug("received openclaw connect.challenge")
          const nonce =
            typeof data.payload === "object" && data.payload && "nonce" in data.payload ? data.payload.nonce : ""
          const id = crypto.randomUUID()
          const connected = (value: unknown) => {
            const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
            const status = typeof payload?.status === "string" ? payload.status : undefined
            if (status === "accepted") return
            this.ws = ws
            finish(resolve)
          }
          this.pending.set(id, {
            resolve(value) {
              connected(value)
            },
            reject(error) {
              finish(() => reject(error))
            },
          })
          void device()
            .then((item) => {
              const signedAt = Date.now()
              const scopes = "operator.admin"
              const payload = [
                "v2",
                item.deviceID,
                clientID,
                "backend",
                "operator",
                scopes,
                `${signedAt}`,
                this.token ?? "",
                String(nonce ?? ""),
              ].join("|")
              const signature = base64url(sign(null, Buffer.from(payload), createPrivateKey(item.privateKey)))
              log.debug("sending openclaw connect", { deviceID: item.deviceID, hasToken: !!this.token })
              ws.send(
                JSON.stringify({
                  type: "req",
                  id,
                  method: "connect",
                  params: {
                    minProtocol: 3,
                    maxProtocol: 3,
                    client: {
                      id: clientID,
                      displayName: "OpenCode",
                      version: InstallationVersion,
                      platform: "bun",
                      mode: "backend",
                    },
                    auth: this.token ? { token: this.token } : undefined,
                    device: {
                      id: item.deviceID,
                      publicKey: base64url(raw(item.publicKey)),
                      signature,
                      signedAt,
                      nonce,
                    },
                    role: "operator",
                    scopes: ["operator.admin"],
                    caps: [],
                    permissions: {},
                  },
                }),
              )
            })
            .catch((err) => {
              log.error("failed to prepare openclaw device identity", { error: err })
              this.pending.delete(id)
              finish(() => reject(err instanceof Error ? err : new Error(String(err))))
            })
          return
        }
        if (typeof data.id === "string") {
          const hit = this.pending.get(data.id)
          if (hit) {
            const res = data as GwResponse
            if (res.ok) {
              const payload =
                res.payload && typeof res.payload === "object" ? (res.payload as Record<string, unknown>) : undefined
              const status = typeof payload?.status === "string" ? payload.status : undefined
              if (status !== "accepted") this.pending.delete(data.id)
              log.debug("openclaw response ok", { id: data.id, status: status ?? "completed" })
              hit.resolve(res.payload)
            } else {
              this.pending.delete(data.id)
              log.error("openclaw response error", {
                id: data.id,
                message: res.error?.message || "Gateway request failed",
              })
              hit.reject(new Error(res.error?.message || "Gateway request failed"))
            }
            return
          }
        }
      }
      ws.onopen = () => undefined
      ws.onerror = () => {
        log.error("openclaw websocket error")
        finish(() => reject(new Error("Failed to connect to OpenClaw gateway")))
      }
      ws.onclose = () => {
        log.warn("openclaw websocket closed")
        this.ws = undefined
        this.ready = undefined
        for (const [id, item] of this.pending) {
          this.pending.delete(id)
          item.reject(new Error("Gateway connection closed"))
        }
        if (!done) finish(() => reject(new Error("Gateway connection closed")))
      }
      setTimeout(() => {
        log.error("openclaw gateway connect timeout")
        finish(() => reject(new Error("Gateway connect timeout")))
      }, 10_000)
    }).finally(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) this.ready = undefined
    })
    return this.ready
  }

  async request(method: string, params?: unknown) {
    await this.connect()
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("Gateway not connected")
    log.debug("openclaw request", { method, params })
    const id = crypto.randomUUID()
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        const hit = this.pending.get(id)
        if (!hit) return
        this.pending.delete(id)
        log.error("openclaw request timeout", { method })
        reject(new Error(`Gateway request timeout: ${method}`))
      }, 30_000)
    })
    this.ws.send(
      JSON.stringify({
        type: "req",
        id,
        method,
        params: params ?? {},
      }),
    )
    return result
  }

  on(fn: (event: GwEvent) => void) {
    this.events.add(fn)
    return () => this.events.delete(fn)
  }
}

class Events {
  private list = new Set<(event: Event) => void>()

  on(fn: (event: Event) => void) {
    this.list.add(fn)
    return () => this.list.delete(fn)
  }

  emit(event: Event) {
    for (const fn of this.list) fn(event)
  }
}

async function sessions(client: GwClient) {
  const res = (await client
    .request("sessions.list", {
      limit: 50,
      includeDerivedTitles: true,
      includeLastMessage: true,
    })
    .catch((err) => {
      throw gatewayError(err, "session listing")
    })) as { sessions?: unknown[] } | unknown[]
  const list = Array.isArray(res) ? res : Array.isArray(res.sessions) ? res.sessions : []
  log.debug("openclaw sessions loaded", { count: list.length })
  return list.map((item: unknown) => session(item as GwSession))
}

async function history(client: GwClient, sessionID: string) {
  const res = (await client.request("chat.history", { sessionKey: sessionID, limit: 200 }).catch((err) => {
    throw gatewayError(err, `history loading for session ${sessionID}`)
  })) as GwHistory | unknown[]
  const list = Array.isArray(res) ? res : Array.isArray(res.messages) ? res.messages : []
  return historyMessages(sessionID, list as GwMessage[])
}

async function waitHistory(
  client: GwClient,
  sessionID: string,
  started: number,
  hit?: { parentID: string; messageID: string; partID: string; tools: Map<string, ToolPart>; prompt?: string },
) {
  for (let i = 0; i < 90; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const list = await history(client, sessionID).catch(() => [])
    const item = hit
      ? current(list, hit, started)
      : [...list].reverse().find((item) => item.info.role === "assistant" && item.info.time.created >= started)
    if (item) return hit ? replay(item, hit) : item
  }
  log.warn("openclaw waitHistory exhausted", { sessionID, started })
}

function current(list: Message[], hit: { parentID: string; messageID?: string }, started: number) {
  const anchor = source(list, hit, started)
  return [...list].reverse().find((item) => {
    if (item.info.role !== "assistant") return false
    if (item.info.id === hit.messageID) return true
    if (item.info.parentID === hit.parentID) return true
    if (anchor && item.info.parentID === anchor) return true
    return item.info.time.created >= started
  })
}

function source(list: Message[], hit: { parentID: string; prompt?: string }, started: number) {
  if (!hit.prompt) return
  // Optimistic user ids differ from gateway history ids. Match the real user
  // turn by prompt text and nearest timestamp, then attach assistant history to it.
  return list
    .filter((item) => item.info.role === "user")
    .filter((item) => inputText(item.parts) === hit.prompt)
    .sort(
      (a, b) =>
        Math.abs(a.info.time.created - started) - Math.abs(b.info.time.created - started) || cmp(a.info.id, b.info.id),
    )[0]?.info.id
}

function replay(
  item: Message,
  hit: { parentID: string; messageID: string; partID: string; tools: Map<string, ToolPart> },
) {
  // Keep streamed history updates on the optimistic ids the current UI is
  // already rendering. Without this remap, tool-only assistant messages can
  // appear briefly and then disappear until the whole session reloads.
  const parts = item.parts.map((part) => {
    if (part.type === "text") {
      return {
        ...part,
        id: hit.partID,
        messageID: hit.messageID,
      }
    }
    return {
      ...part,
      id: hit.tools.get(part.callID)?.id ?? partID(hit.messageID, part.callID),
      messageID: hit.messageID,
    }
  })

  return {
    ...item,
    info: {
      ...item.info,
      id: hit.messageID,
      parentID: hit.parentID,
    },
    parts,
  } satisfies Message
}

function stamp(item: Message) {
  // Replayed assistant messages can reuse the same message id while their tool
  // parts change from running to completed. Track a small content signature so
  // pumpHistory re-emits meaningful state transitions instead of dropping them.
  return JSON.stringify({
    id: item.info.id,
    parts: item.parts.map((part) =>
      part.type === "text"
        ? { id: part.id, type: part.type, text: part.text }
        : { id: part.id, type: part.type, callID: part.callID, tool: part.tool, state: part.state.status },
    ),
  })
}

async function pumpHistory(
  client: GwClient,
  sessionID: string,
  started: number,
  hit: { parentID: string; messageID: string; partID: string; tools: Map<string, ToolPart>; prompt?: string },
  seen: Map<string, string>,
  onItem: (item: Message) => void,
) {
  const list = await history(client, sessionID).catch(() => [])
  const anchor = source(list, hit, started)
  const next = list
    .filter((item) => item.info.role === "assistant")
    .filter(
      (item) =>
        item.info.id === hit.messageID ||
        item.info.parentID === hit.parentID ||
        item.info.parentID === anchor ||
        item.info.time.created >= started,
    )
    .filter((item) => seen.get(item.info.id) !== stamp(item))
    .sort((a, b) => a.info.time.created - b.info.time.created || cmp(a.info.id, b.info.id))
  for (const item of next) {
    seen.set(item.info.id, stamp(item))
    onItem(replay(item, hit))
  }
  return next
}

function emitHistory(events: Events, item: Message) {
  events.emit({
    directory,
    payload: {
      type: "message.updated",
      properties: { info: item.info },
    },
  })
  for (const part of item.parts) {
    events.emit({
      directory,
      payload: {
        type: "message.part.updated",
        properties: { part },
      },
    })
  }
}

export namespace OpenClawBridge {
  export const internal = {
    current,
    historyMessages,
    source,
    stamp,
    streamParts,
  }

  export function createApp(opts: Opts) {
    const app = new Hono()
    const gw = new GwClient(opts.gateway.url, opts.gateway.token)
    const events = new Events()
    const runs = new Map<
      string,
      {
        sessionID: string
        messageID: string
        partID: string
        parentID: string
        started: number
        text: string
        created: boolean
        tools: Map<string, ToolPart>
      }
    >()
    const active = new Map<
      string,
      {
        parentID: string
        messageID: string
        partID: string
        tools: Map<string, ToolPart>
      }
    >()
    // Cache the just-submitted user turn until gateway history catches up, so
    // OpenCode can render the turn immediately in a new OpenClaw conversation.
    const sentMap = new Map<string, Message[]>()

    const info = (
      hit: {
        sessionID: string
        messageID: string
        parentID: string
      },
      message?: Record<string, unknown>,
      completed?: number,
    ) => ({
      id: hit.messageID,
      sessionID: hit.sessionID,
      role: "assistant" as const,
      time: completed ? { created: Date.now(), completed } : { created: Date.now() },
      parentID: hit.parentID,
      providerID: String(message?.provider || providerID),
      modelID: String(message?.model || modelID),
      mode: "default",
      agent: "claw",
      path: { cwd: `${directory}/${hit.sessionID}`, root: directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    const ensure = (
      hit: {
        sessionID: string
        messageID: string
        parentID: string
        created: boolean
      },
      message?: Record<string, unknown>,
      completed?: number,
    ) => {
      if (hit.created) return
      hit.created = true
      events.emit({
        directory,
        payload: { type: "message.updated", properties: { info: info(hit, message, completed) } },
      })
    }

    const emitStatus = (sessionID: string, type: "busy" | "idle") => {
      events.emit({
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID, status: { type } },
        },
      })
    }

    const emitPart = (runID: string, payload: Record<string, unknown>) => {
      const hit = runs.get(runID)
      if (!hit) return
      const message =
        payload.message && typeof payload.message === "object"
          ? (payload.message as Record<string, unknown>)
          : undefined
      const stream = streamParts(hit.messageID, hit.sessionID, payload.message, Date.now(), hit.tools)
      const calls = stream.calls
      const results = stream.results
      if (calls.length > 0 || results.length > 0) ensure(hit, message)
      for (const part of stream.parts) {
        hit.tools.set(part.callID, part)
        events.emit({ directory, payload: { type: "message.part.updated", properties: { part } } })
      }
      const body = text(message?.content)
      if (!body) return
      if (!hit.text) {
        ensure(hit, message)
        const part = {
          id: hit.partID,
          sessionID: hit.sessionID,
          messageID: hit.messageID,
          type: "text",
          text: "",
        }
        events.emit({ directory, payload: { type: "message.part.updated", properties: { part } } })
      }
      const delta = body.startsWith(hit.text) ? body.slice(hit.text.length) : body
      hit.text = body
      if (!delta) return
      log.debug("openclaw emit message.part.delta", {
        runID,
        sessionID: hit.sessionID,
        messageID: hit.messageID,
        delta,
      })
      events.emit({
        directory,
        payload: {
          type: "message.part.delta",
          properties: {
            sessionID: hit.sessionID,
            messageID: hit.messageID,
            partID: hit.partID,
            field: "text",
            delta,
          },
        },
      })
    }

    const finish = async (runID: string, payload: Record<string, unknown>, state: "final" | "aborted" | "error") => {
      const hit = runs.get(runID)
      if (!hit) return
      log.info("openclaw run finished", {
        runID,
        sessionID: hit.sessionID,
        state,
        text: hit.text,
        parentID: hit.parentID,
      })
      if (state === "error") {
        events.emit({
          directory,
          payload: {
            type: "session.error",
            properties: {
              sessionID: hit.sessionID,
              error: {
                name: "UnknownError",
                data: { message: String(payload.errorMessage || "OpenClaw run failed") },
              },
            },
          },
        })
      }
      if (state === "final" && hit.created) {
        events.emit({
          directory,
          payload: {
            type: "message.updated",
            properties: { info: info(hit, undefined, Date.now()) },
          },
        })
      }
      if (state === "final" && !hit.text) {
        const item = await waitHistory(gw, hit.sessionID, hit.started, {
          parentID: hit.parentID,
          messageID: hit.messageID,
          partID: hit.partID,
          tools: hit.tools,
        }).catch(() => undefined)
        if (item) emitHistory(events, item)
      }
      if (state === "final" || (state === "aborted" && hit.text)) {
        const list = await sessions(gw).catch(() => [])
        const info = list.find((item: Session) => item.id === hit.sessionID)
        if (info) {
          log.debug("openclaw emit session.updated", { sessionID: info.id, title: info.title })
          events.emit({
            directory,
            payload: {
              type: "session.updated",
              properties: { info },
            },
          })
        }
      }
      sentMap.set(
        hit.sessionID,
        (sentMap.get(hit.sessionID) ?? []).filter((item) => item.info.id !== hit.parentID),
      )
      emitStatus(hit.sessionID, "idle")
      const current = active.get(hit.sessionID)
      if (current?.parentID === hit.parentID && current.messageID === hit.messageID) {
        active.delete(hit.sessionID)
      }
      runs.delete(runID)
    }

    gw.on((event) => {
      if (event.event !== "chat") return
      const payload = event.payload ?? {}
      const runID = typeof payload.runId === "string" ? payload.runId : undefined
      if (!runID) return
      const state = typeof payload.state === "string" ? payload.state : undefined
      log.info("openclaw gw chat event", {
        runID,
        state,
        keys: Object.keys(payload),
        messageShape: shape(payload.message),
        preview: preview(payload.message),
      })
      if (state === "delta") {
        emitPart(runID, payload)
        return
      }
      if (state === "final") {
        emitPart(runID, payload)
        void finish(runID, payload, "final")
        return
      }
      if (state === "aborted") {
        void finish(runID, payload, "aborted")
        return
      }
      if (state === "error") {
        void finish(runID, payload, "error")
      }
    })

    return app
      .onError((err, c) => {
        const message = err instanceof Error ? err.message : String(err)
        log.error("openclaw bridge request failed", { error: message })
        return c.json(new NamedError.Unknown({ message }).toObject(), { status: 500 })
      })
      .use((c, next) => {
        const password = process.env.OPENCODE_SERVER_PASSWORD
        if (!password || c.req.method === "OPTIONS") return next()
        return basicAuth({ username: process.env.OPENCODE_SERVER_USERNAME ?? "opencode", password })(c, next)
      })
      .use(
        cors({
          origin(input) {
            if (!input) return
            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (
              input === "tauri://localhost" ||
              input === "http://tauri.localhost" ||
              input === "https://tauri.localhost"
            )
              return input
            if (opts.cors?.includes(input)) return input
            return
          },
        }),
      )
      .get("/global/health", async (c) => {
        try {
          await sessions(gw)
          return c.json({ healthy: true, version: InstallationVersion })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error("openclaw health failed", { error: message })
          return c.json(new NamedError.Unknown({ message }).toObject(), { status: 503 })
        }
      })
      .get("/global/config", (c) => c.json({ model: `${providerID}/${modelID}` }))
      .patch("/global/config", async (c) =>
        c.json(await c.req.json().catch(() => ({ model: `${providerID}/${modelID}` }))),
      )
      .post("/global/dispose", (c) => c.json(true))
      .get("/global/event", async (c) => {
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({ data: JSON.stringify({ payload: { type: "server.connected", properties: {} } }) })
          const off = events.on((event) => {
            void stream.writeSSE({ data: JSON.stringify(event) })
          })
          const timer = setInterval(() => {
            stream.writeSSE({ data: JSON.stringify({ payload: { type: "server.heartbeat", properties: {} } }) })
          }, 10_000)
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              off()
              clearInterval(timer)
              resolve()
            })
          })
        })
      })
      .get("/path", (c) =>
        c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: directory,
          directory,
        }),
      )
      .get("/project", (c) =>
        c.json([
          {
            id: projectID,
            worktree: directory,
            name: "OpenClaw",
            time: { created: Date.now(), updated: Date.now() },
            sandboxes: [],
          },
        ]),
      )
      .get("/project/current", (c) =>
        c.json({
          id: projectID,
          worktree: directory,
          name: "OpenClaw",
          time: { created: Date.now(), updated: Date.now() },
          sandboxes: [],
        }),
      )
      .get("/provider", (c) =>
        c.json({
          all: [provider],
          default: { [providerID]: `${providerID}/${modelID}` },
          connected: [providerID],
        }),
      )
      .get("/provider/auth", (c) => c.json({}))
      .get("/config", (c) => c.json({}))
      .get("/command", (c) => c.json([]))
      .get("/agent", (c) => c.json([agent]))
      .get("/skill", (c) => c.json([]))
      .get("/mcp", (c) => c.json({}))
      .get("/lsp", (c) => c.json([]))
      .get("/vcs", (c) => c.json({ branch: "openclaw" }))
      .get("/file", () => {
        throw new Error(fileUnsupported)
      })
      .get("/file/content", () => {
        throw new Error(fileUnsupported)
      })
      .get("/file/status", (c) => c.json([]))
      .get("/permission", (c) => c.json([]))
      .get("/question", (c) => c.json([]))
      .get("/session/status", (c) => c.json({}))
      .get("/session", async (c) => c.json(await sessions(gw)))
      .post("/session", async (c) => {
        const body = await c.req.json().catch(() => ({}))
        const sid = body?.id || crypto.randomUUID()
        return c.json({
          id: sid,
          slug: sid,
          projectID,
          directory,
          title: body?.title || sid,
          version,
          time: { created: Date.now(), updated: Date.now() },
        })
      })
      .get("/session/:sessionID", async (c) => {
        const sessionID = c.req.param("sessionID")
        const list = await sessions(gw)
        const item = list.find((item: Session) => item.id === sessionID)
        if (item) return c.json(item)
        return c.json(
          {
            id: sessionID,
            slug: sessionID,
            projectID,
            directory,
            title: sessionID,
            version,
            time: { created: Date.now(), updated: Date.now() },
          },
          200,
        )
      })
      .get("/session/:sessionID/todo", (c) => c.json([]))
      .get("/session/:sessionID/children", (c) => c.json([]))
      .get("/session/:sessionID/message", async (c) => {
        const sessionID = c.req.param("sessionID")
        return c.json(mergeHistory(await history(gw, sessionID), sentMap.get(sessionID) ?? []))
      })
      .post("/session/:sessionID/prompt_async", async (c) => {
        const sessionID = c.req.param("sessionID")
        const body = (await c.req.json().catch(() => ({}))) as PromptBody
        const message = prompt(body?.parts)
        const started = Date.now()
        const optimistic = sent(sessionID, body)
        sentMap.set(sessionID, [...(sentMap.get(sessionID) ?? []), optimistic])
        log.info("openclaw prompt_async", { sessionID, message })
        void gw
          .request("chat.send", {
            sessionKey: sessionID,
            message,
            deliver: false,
            idempotencyKey: crypto.randomUUID(),
          })
          .then((res) => {
            const runID =
              typeof (res as Record<string, unknown>)?.runId === "string"
                ? String((res as Record<string, unknown>).runId)
                : crypto.randomUUID()
            const current = active.get(sessionID)
            const messageID =
              current?.parentID === optimistic.info.id ? current.messageID : Identifier.ascending("message")
            const partID = current?.parentID === optimistic.info.id ? current.partID : Identifier.ascending("part")
            const tools = current?.parentID === optimistic.info.id ? current.tools : new Map<string, ToolPart>()
            runs.set(runID, {
              sessionID,
              messageID,
              partID,
              parentID: optimistic.info.id,
              started,
              text: "",
              created: false,
              tools,
            })
            active.set(sessionID, { parentID: optimistic.info.id, messageID, partID, tools })
            log.debug("openclaw prompt_async accepted", { sessionID, runID })
            emitStatus(sessionID, "busy")
            const seen = new Map<string, string>()
            void (async () => {
              for (let i = 0; i < 90; i++) {
                await new Promise((resolve) => setTimeout(resolve, 500))
                if (!runs.has(runID)) break
                await pumpHistory(
                  gw,
                  sessionID,
                  started,
                  { parentID: optimistic.info.id, messageID, partID, tools, prompt: message },
                  seen,
                  (item) => emitHistory(events, item),
                )
              }
            })()
            void waitHistory(gw, sessionID, started, {
              parentID: optimistic.info.id,
              messageID,
              partID,
              tools,
              prompt: message,
            })
              .then((item) => {
                if (!item) return
                log.debug("openclaw prompt_async history hit", {
                  sessionID,
                  messageID: item.info.id,
                  created: item.info.time.created,
                })
                emitHistory(events, item)
                emitStatus(sessionID, "idle")
              })
              .catch(() => emitStatus(sessionID, "idle"))
          })
          .catch(() => {
            log.error("openclaw prompt_async failed", { sessionID })
            events.emit({
              directory,
              payload: {
                type: "session.error",
                properties: {
                  sessionID,
                  error: { name: "UnknownError", data: { message: "OpenClaw send failed" } },
                },
              },
            })
            emitStatus(sessionID, "idle")
          })
        return c.body(null, 204)
      })
      .post("/session/:sessionID/message", async (c) => {
        const sessionID = c.req.param("sessionID")
        const body = (await c.req.json().catch(() => ({}))) as PromptBody
        const message = prompt(body?.parts)
        const optimistic = sent(sessionID, body)
        sentMap.set(sessionID, [...(sentMap.get(sessionID) ?? []), optimistic])
        log.info("openclaw message", { sessionID, message })
        const started = Date.now()
        const res = await gw.request("chat.send", {
          sessionKey: sessionID,
          message,
          deliver: false,
          idempotencyKey: crypto.randomUUID(),
        })
        const runID =
          typeof (res as Record<string, unknown>)?.runId === "string"
            ? String((res as Record<string, unknown>).runId)
            : crypto.randomUUID()
        const current = active.get(sessionID)
        const messageID = current?.parentID === optimistic.info.id ? current.messageID : Identifier.ascending("message")
        const partID = current?.parentID === optimistic.info.id ? current.partID : Identifier.ascending("part")
        const tools = current?.parentID === optimistic.info.id ? current.tools : new Map<string, ToolPart>()
        runs.set(runID, {
          sessionID,
          messageID,
          partID,
          parentID: optimistic.info.id,
          started,
          text: "",
          created: false,
          tools,
        })
        active.set(sessionID, { parentID: optimistic.info.id, messageID, partID, tools })
        log.debug("openclaw message accepted", { sessionID, runID })
        emitStatus(sessionID, "busy")
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (stream) => {
          const seen = new Map<string, string>()
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 300))
            const items = await pumpHistory(
              gw,
              sessionID,
              started,
              { parentID: optimistic.info.id, messageID, partID, tools, prompt: message },
              seen,
              (item) => emitHistory(events, item),
            )
            if (items.length > 0) break
            if (!runs.has(runID)) break
          }
          const item = await waitHistory(gw, sessionID, started, {
            parentID: optimistic.info.id,
            messageID,
            partID,
            tools,
            prompt: message,
          })
          if (!item) log.warn("openclaw message completed without assistant reply", { sessionID })
          for (let i = 0; i < 45; i++) {
            await new Promise((resolve) => setTimeout(resolve, 200))
            if (runs.has(runID)) continue
            break
          }
          stream.write(JSON.stringify(item ?? null))
        })
      })
  }

  export function listen(opts: Opts) {
    const app = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)
    return server
  }
}
