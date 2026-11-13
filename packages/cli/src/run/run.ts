import { Service, type Endpoint } from "@opencode/client/effect/service"
import { OpenCode, type SessionMessageAssistantTool } from "@opencode/client/promise"
import { FSUtil } from "@opencode/util/fs-util"
import { noTimeoutFetch } from "@opencode/util/no-timeout-fetch"
import { open } from "node:fs/promises"
import path from "node:path"
import { readStdin, readStdinIfReady } from "../util/io"
import { ServerConnection } from "../services/server-connection"
import { createWorktreeLocation, parseSessionTargetModel, resolveSessionTarget } from "../session-target"
import { toolInlineInfo } from "@opencode/tui/mini/tool"
import { runNonInteractivePrompt } from "./noninteractive"
import { UI } from "./ui"
import { Env } from "../env"
import { errorMessage } from "../util/error"

export type RunCommandInput = {
  server: ServerConnection.Resolved
  message: string[]
  continue?: boolean
  session?: string
  fork?: boolean
  worktree?: string | true
  model?: string
  agent?: string
  format: "default" | "json"
  file: string[]
  title?: string
  archived?: boolean
  thinking?: boolean
  auto?: boolean
}

type FilePart = { text: string } | { attachment: { uri: string; name: string } }

type Prepared = {
  directory: string
  message: string
  files: FilePart[]
}

class RunTargetError extends Error {
  constructor(
    message: string,
    readonly sessionID?: string,
  ) {
    super(message)
  }
}

const ATTACH_FILE_MAX_BYTES = 10 * 1024 * 1024
const PIPED_INPUT_GRACE_MS = 1000

/** `signal` aborts on SIGINT or SIGTERM; the run then cancels its Session and background jobs and returns. */
export function runNonInteractive(input: RunCommandInput, signal: AbortSignal) {
  return run(input, signal).catch((error) => reportRunError(input, errorMessage(error)))
}

async function run(input: RunCommandInput, signal: AbortSignal) {
  if (input.fork && !input.continue && !input.session) fail("--fork requires --continue or --session")
  if (input.worktree !== undefined && (input.continue || input.session))
    fail("--worktree starts a new session and cannot be combined with --continue or --session")
  const root = FSUtil.windowsPath(process.env.PWD ?? process.cwd())
  const directory = localDirectory(root)
  const argument = input.message.join(" ") || undefined
  // With a message argument, stdin is extra context: a shell pipe is read in full, but the open, silent
  // stdin that spawn's default stdio gives a child must not hold the run.
  const piped = process.stdin.isTTY
    ? undefined
    : argument
      ? await readStdinIfReady(PIPED_INPUT_GRACE_MS)
      : await readStdin()
  const message = mergeInput(argument, piped)
  if (!message?.trim()) fail("You must provide a message")
  const files = await Promise.all(input.file.map((file) => prepareFile(file, root)))
  return execute(input, { directory, message, files }, input.server.endpoint, signal)
}

async function execute(input: RunCommandInput, prepared: Prepared, endpoint: Endpoint, signal: AbortSignal) {
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
    // Bun's default five-minute deadline terminates the event stream used by long-running sessions.
    fetch: noTimeoutFetch,
  })
  const explicit = parseRunModel(input.model)
  const location = { directory: prepared.directory }
  const worktree =
    input.worktree === undefined
      ? undefined
      : await createWorktreeLocation({
          client,
          location,
          name: input.worktree === true ? undefined : input.worktree,
        })
  if (worktree) UI.println(UI.Style.TEXT_DIM + "worktree " + worktree.root + UI.Style.TEXT_NORMAL)
  const target = await resolveSessionTarget({
    client,
    location: worktree ? { directory: worktree.directory } : location,
    continue: input.continue,
    session: input.session,
    fork: input.fork,
    model: explicit
      ? { providerID: explicit.model.providerID, id: explicit.model.modelID, variant: explicit.variant }
      : undefined,
    agent: input.agent,
    environment: input.server.service ? Env.session() : undefined,
    prepare: async (next) => {
      if (explicit?.variant && !next.model)
        throw new RunTargetError("Cannot select a variant before selecting a model", next.session?.id)
      return { model: next.model, agent: next.agent }
    },
  }).catch((error) => {
    if (!(error instanceof RunTargetError)) throw error
    reportRunError(input, error.message, error.sessionID)
    return undefined
  })
  if (!target) return
  const title =
    !target.resume && input.title !== undefined
      ? input.title || prepared.message.slice(0, 50) + (prepared.message.length > 50 ? "..." : "")
      : undefined
  // Archive before the first prompt is admitted, so the run never reaches an inbox as working or finished.
  const archived = input.archived && (!target.resume || input.fork) ? true : undefined
  if (title !== undefined || archived) {
    await client.session.update({ sessionID: target.session.id, title, archived })
  }

  await runNonInteractivePrompt({
    client,
    sessionID: target.session.id,
    location: target.location,
    message: [prepared.message, ...prepared.files.flatMap((file) => ("text" in file ? [file.text] : []))].join("\n\n"),
    files: prepared.files.flatMap((file) => ("attachment" in file ? [file.attachment] : [])),
    agent: target.agent,
    model: target.model,
    thinking: input.thinking ?? false,
    format: input.format,
    auto: input.auto ?? false,
    standalone: input.server.standalone ?? false,
    signal,
    renderTool: (part) => renderTool(part, target.location.directory),
    renderToolError: (part) => renderToolError(part, target.location.directory),
  }).catch((error) => reportRunError(input, errorMessage(error), target.session.id))
}

export function mergeInput(message: string | undefined, piped: string | undefined) {
  if (!message) return piped || undefined
  if (!piped) return message
  return message + "\n" + piped
}

function localDirectory(root: string) {
  try {
    process.chdir(root)
    return process.cwd()
  } catch {
    fail(`Failed to change directory to ${root}`)
  }
}

export function parseRunModel(value?: string) {
  const ref = parseSessionTargetModel(value)
  if (!ref) return
  return {
    model: { providerID: ref.providerID, modelID: ref.id },
    variant: ref.variant,
  }
}

async function prepareFile(input: string, directory: string): Promise<FilePart> {
  const file = path.resolve(directory, input)
  const handle = await open(file, "r").catch(() => fail(`File not found: ${input}`))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > ATTACH_FILE_MAX_BYTES)
      fail(`Cannot attach a directory, special file, or file larger than 10 MiB: ${input}`)
    const content = Buffer.alloc(Number(stat.size))
    let offset = 0
    while (offset < content.length) {
      const read = await handle.read(content, offset, content.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    const bytes = content.subarray(0, offset)
    const detected = FSUtil.mimeType(file)
    const text = bytes.toString("utf8")
    const mime =
      detected.startsWith("image/") || detected === "application/pdf"
        ? detected
        : !isBinaryContent(bytes) && Buffer.from(text, "utf8").equals(bytes)
          ? "text/plain"
          : detected
    const name = path.basename(file)
    if (mime === "text/plain") return { text: `<file name="${name}">\n${text}\n</file>` }
    return { attachment: { uri: `data:${mime};base64,${bytes.toString("base64")}`, name } }
  } finally {
    await handle.close()
  }
}

function isBinaryContent(bytes: Uint8Array) {
  if (bytes.length === 0) return false
  if (bytes.includes(0)) return true
  return bytes.reduce((count, byte) => count + Number(byte < 9 || (byte > 13 && byte < 32)), 0) / bytes.length > 0.3
}

async function renderTool(part: SessionMessageAssistantTool, directory: string) {
  const info = toolInlineInfo(part, directory)
  if (info.mode === "block") {
    UI.empty()
    UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title)
    if (info.body?.trim()) UI.println(info.body)
    UI.empty()
    return
  }
  UI.println(
    UI.Style.TEXT_NORMAL + info.icon,
    UI.Style.TEXT_NORMAL + info.title,
    info.description ? UI.Style.TEXT_DIM + info.description + UI.Style.TEXT_NORMAL : "",
  )
}

async function renderToolError(part: SessionMessageAssistantTool, directory: string) {
  const info = toolInlineInfo(part, directory)
  UI.println(UI.Style.TEXT_NORMAL + "✗", UI.Style.TEXT_NORMAL + `${info.title} failed`)
}

export function reportRunError(input: Pick<RunCommandInput, "format">, message: string, sessionID?: string) {
  process.exitCode = 1
  if (input.format === "json") {
    process.stdout.write(
      JSON.stringify({
        type: "error",
        timestamp: Date.now(),
        sessionID: sessionID ?? "",
        error: { type: "unknown", message },
      }) + "\n",
    )
    return
  }
  UI.error(message)
}

function fail(message: string): never {
  throw new Error(message)
}
