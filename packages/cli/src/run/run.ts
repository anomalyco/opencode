import { Service, type Endpoint } from "@opencode-ai/client/effect/service"
import { OpenCode, type OpenCodeClient, type SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { open } from "node:fs/promises"
import path from "node:path"
import { readStdin } from "../util/io"
import { ServerConnection } from "../services/server-connection"
import { waitForCatalogReady } from "../services/catalog"
import { parseSessionTargetModel, resolveSessionTarget } from "../session-target"
import { toolInlineInfo } from "@opencode-ai/tui/mini/tool"
import { runNonInteractivePrompt } from "./noninteractive"
import { UI } from "./ui"

export type RunCommandInput = {
  server: ServerConnection.Resolved
  message: string[]
  continue?: boolean
  session?: string
  fork?: boolean
  model?: string
  agent?: string
  format: "default" | "json"
  file: string[]
  title?: string
  thinking?: boolean
  auto?: boolean
}

type FilePart = {
  url: string
  filename: string
  mime: string
}

type Prepared = {
  directory?: string
  message: string
  files: FilePart[]
}

type ExecutionOptions = {
  root?: string
  directory?: string
  useServerDirectory?: boolean
  variant?: string
  attached?: boolean
  compatibility?: "v1"
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

export function runNonInteractive(input: RunCommandInput) {
  return runNonInteractiveWithOptions(input, {})
}

/** @internal Used only by the V1 command boundary. */
export function runNonInteractiveWithOptions(input: RunCommandInput, options: ExecutionOptions) {
  return run(input, options).catch((error) => reportRunError(input, errorMessage(error)))
}

async function run(input: RunCommandInput, options: ExecutionOptions) {
  if (input.fork && !input.continue && !input.session) fail("--fork requires --continue or --session")
  const root = options.root ?? process.env.PWD ?? process.cwd()
  const local = localDirectory(root)
  const directory = options.useServerDirectory ? undefined : (options.directory ?? local)
  const message = mergeInput(formatMessage(input.message), process.stdin.isTTY ? undefined : await readStdin())
  if (!message?.trim()) fail("You must provide a message")
  const files = await Promise.all(input.file.map((file) => prepareFile(file, root, options)))
  const prepared = { directory, message, files }
  return execute(input, prepared, input.server.endpoint, options)
}

async function execute(input: RunCommandInput, prepared: Prepared, endpoint: Endpoint, options: ExecutionOptions) {
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const explicit = parseRunModel(input.model)
  const target = await resolveSessionTarget({
    client,
    location: prepared.directory ? { directory: prepared.directory } : undefined,
    continue: input.continue,
    session: input.session,
    fork: input.fork,
    model: explicit
      ? { providerID: explicit.model.providerID, id: explicit.model.modelID, variant: explicit.variant }
      : undefined,
    agent: input.agent,
    prepare: async (next) => {
      const selected =
        next.model ??
        (await client.model
          .default({ location: { directory: next.location.directory, workspace: next.location.workspaceID } })
          .then((result) => result.data))
      const model = selected
        ? {
            providerID: selected.providerID,
            id: selected.id,
            variant: options.variant ?? ("variant" in selected ? selected.variant : undefined),
          }
        : undefined
      if ((options.variant ?? explicit?.variant) && !model)
        throw new RunTargetError("Cannot select a variant before selecting a model", next.session?.id)
      if (model) {
        await waitForCatalogReady({
          sdk: client,
          directory: next.location.directory,
          workspace: next.location.workspaceID,
          model: { providerID: model.providerID, modelID: model.id },
        })
        const available = await client.model.list({
          location: { directory: next.location.directory, workspace: next.location.workspaceID },
        })
        if (!available.data.some((item) => item.providerID === model.providerID && item.id === model.id))
          throw new RunTargetError(`Model unavailable: ${model.providerID}/${model.id}`, next.session?.id)
      }
      return {
        model,
        agent: input.agent
          ? await validateAgent(client, next.location.directory, next.location.workspaceID, input.agent)
          : next.agent,
      }
    },
  }).catch((error) => {
    if (!(error instanceof RunTargetError)) throw error
    reportRunError(input, error.message, error.sessionID)
    return undefined
  })
  if (!target) return
  const model = target.model ? { providerID: target.model.providerID, modelID: target.model.id } : undefined
  const variant = target.model?.variant
  if (!target.resume && input.title !== undefined) {
    await client.session.rename({
      sessionID: target.session.id,
      title: input.title || prepared.message.slice(0, 50) + (prepared.message.length > 50 ? "..." : ""),
    })
  }

  await runNonInteractivePrompt({
    client,
    sessionID: target.session.id,
    location: target.location,
    message: prepared.message,
    files: prepared.files,
    agent: target.agent,
    model,
    variant,
    thinking: input.thinking ?? false,
    format: input.format,
    auto: input.auto ?? false,
    attached: options.attached ?? true,
    compatibility: options.compatibility,
    renderTool: (part) => renderTool(part, target.location.directory),
    renderToolError: (part) => renderToolError(part, target.location.directory),
  }).catch((error) => reportRunError(input, errorMessage(error), target.session.id))
}

export function mergeInput(message: string | undefined, piped: string | undefined) {
  if (!message) return piped || undefined
  if (!piped) return message
  return message + "\n" + piped
}

function formatMessage(message: string[]) {
  const value = message.map((part) => (part.includes(" ") ? `"${part.replace(/"/g, '\\"')}"` : part)).join(" ")
  return value || undefined
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

async function validateAgent(client: OpenCodeClient, directory: string, workspace: string | undefined, name?: string) {
  if (!name) return
  const agents = await client.agent
    .list({ location: { directory, workspace } })
    .then((result) => result.data)
    .catch(() => undefined)
  if (!agents) {
    warning("failed to list agents. Falling back to default agent")
    return
  }
  const agent = agents.find((item) => item.id === name)
  if (!agent) {
    warning(`agent "${name}" not found. Falling back to default agent`)
    return
  }
  if (agent.mode === "subagent") {
    warning(`agent "${name}" is a subagent, not a primary agent. Falling back to default agent`)
    return
  }
  return name
}

async function prepareFile(input: string, directory: string, options: ExecutionOptions): Promise<FilePart> {
  const file = path.resolve(directory, input)
  const handle = await open(file, "r").catch(() => fail(`File not found: ${input}`))
  try {
    const stat = await handle.stat()
    if (options.compatibility === "v1" && options.attached && stat.isDirectory())
      fail(`Cannot attach local directory without a shared filesystem: ${input}`)
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
    return {
      url: `data:${mime};base64,${bytes.toString("base64")}`,
      filename: path.basename(file),
      mime,
    }
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

function warning(message: string) {
  UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL, message)
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
    return error.message
  return String(error)
}

/** @internal Used by the V1 command boundary before a Session exists. */
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
