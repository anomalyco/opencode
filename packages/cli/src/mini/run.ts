import { NodeFileSystem } from "@effect/platform-node"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import { open } from "node:fs/promises"
import path from "node:path"
import { Daemon } from "../daemon"
import { Standalone } from "../services/standalone"
import { loadRunAgents, waitForCatalogReady } from "./catalog.shared"
import { runNonInteractivePrompt } from "./noninteractive"
import { toolInlineInfo } from "./tool"
import { UI } from "./ui"

export type RunCommandInput = {
  message: string[]
  continue?: boolean
  session?: string
  fork?: boolean
  model?: string
  agent?: string
  format: "default" | "json"
  file: string[]
  title?: string
  server?: string
  password?: string
  username?: string
  directory?: string
  variant?: string
  thinking?: boolean
  dangerouslySkipPermissions?: boolean
  standaloneCommand?: ReadonlyArray<string>
}

type FilePart = {
  url: string
  filename: string
  mime: string
}

type Transport = { readonly url: string; readonly headers?: HeadersInit }

type Prepared = {
  directory?: string
  message: string
  files: FilePart[]
}

const ATTACH_FILE_MAX_BYTES = 10 * 1024 * 1024

export function runNonInteractive(input: RunCommandInput) {
  return run(input).catch((error) => reportError(input, error instanceof Error ? error.message : String(error)))
}

async function run(input: RunCommandInput) {
  if (input.fork && !input.continue && !input.session) fail("--fork requires --continue or --session")
  const root = process.env.PWD ?? process.cwd()
  const directory = input.server ? input.directory : localDirectory(input.directory, root)
  const message = mergeInput(formatMessage(input.message), process.stdin.isTTY ? undefined : await Bun.stdin.text())
  if (!message?.trim()) fail("You must provide a message")
  const files = await Promise.all(
    input.file.map((file) => prepareFile(file, input.server ? root : (directory ?? root), input.server !== undefined)),
  )
  const prepared = { directory, message, files }
  if (input.standaloneCommand)
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const transport = yield* Standalone.transport({ command: input.standaloneCommand })
          yield* Effect.promise(() => execute(input, prepared, transport))
        }),
      ),
    )
  const transport = await startTransport(input)
  return execute(input, prepared, transport)
}

async function execute(input: RunCommandInput, prepared: Prepared, transport: Transport) {
  const client = OpenCode.make({ baseUrl: transport.url, headers: transport.headers })
  const requestedDirectory = prepared.directory ?? (await client.location.get()).directory
  if (!requestedDirectory) fail("Failed to resolve server directory")
  const session = await selectSession(client, requestedDirectory, input)
  const cwd = session?.location.directory ?? requestedDirectory
  const workspace = session?.location.workspaceID
  const explicitModel = parseModel(input.model)
  const sessionModel = session?.model ? { providerID: session.model.providerID, modelID: session.model.id } : undefined
  const defaultModel =
    !explicitModel && !sessionModel
      ? await client.model
          .default({ location: { directory: cwd, workspace } })
          .then((result) => (result.data ? { providerID: result.data.providerID, modelID: result.data.id } : undefined))
      : undefined
  const model = pickRunModel(explicitModel, input.variant, sessionModel, defaultModel)
  if (input.variant && !model)
    return reportError(input, "Cannot select a variant before selecting a model", session?.id)
  if (model) {
    await waitForCatalogReady({ sdk: client, directory: cwd, workspace, model })
    const available = await client.model.list({ location: { directory: cwd, workspace } })
    if (!available.data.some((item) => item.providerID === model.providerID && item.id === model.modelID))
      return reportError(input, `Model unavailable: ${model.providerID}/${model.modelID}`, session?.id)
  }
  const agent = await validateAgent(client, cwd, input.agent, input.server)
  const selected =
    session ??
    (await client.session.create({
      agent,
      model: model ? { providerID: model.providerID, id: model.modelID, variant: input.variant } : undefined,
      location: { directory: cwd },
    }))
  if (!session && input.title !== undefined) {
    await client.session.rename({
      sessionID: selected.id,
      title: input.title || prepared.message.slice(0, 50) + (prepared.message.length > 50 ? "..." : ""),
    })
  }

  await runNonInteractivePrompt({
    client,
    sessionID: selected.id,
    message: prepared.message,
    files: prepared.files,
    agent,
    model,
    variant: input.variant,
    thinking: input.thinking ?? false,
    format: input.format,
    dangerouslySkipPermissions: input.dangerouslySkipPermissions ?? false,
    attached: !input.standaloneCommand,
    renderTool,
    renderToolError,
  }).catch((error) => reportError(input, error instanceof Error ? error.message : String(error), selected.id))
}

export function mergeInput(message: string | undefined, piped: string | undefined) {
  if (!message) return piped || undefined
  if (!piped) return message
  return message + "\n" + piped
}

export function pickRunModel(
  explicit: { providerID: string; modelID: string } | undefined,
  variant: string | undefined,
  session: { providerID: string; modelID: string } | undefined,
  fallback: { providerID: string; modelID: string } | undefined,
) {
  if (explicit) return explicit
  if (!variant) return
  return session ?? fallback
}

function formatMessage(message: string[]) {
  const value = message.map((part) => (part.includes(" ") ? `"${part.replace(/"/g, '\\"')}"` : part)).join(" ")
  return value || undefined
}

function localDirectory(directory: string | undefined, root: string) {
  try {
    process.chdir(directory ? (path.isAbsolute(directory) ? directory : path.join(root, directory)) : root)
    return process.cwd()
  } catch {
    fail(`Failed to change directory to ${directory}`)
  }
}

function startTransport(input: RunCommandInput) {
  if (input.server) {
    return Effect.runPromise(
      Daemon.transport({
        mode: "attach",
        url: input.server,
        password: input.password,
        username: input.username,
      }),
    )
  }
  return Effect.runPromise(
    Daemon.transport({ mode: "shared" }).pipe(
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(Global.layerWith({})),
    ),
  )
}

function parseModel(value?: string) {
  if (!value) return
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) fail("--model must use the format provider/model")
  return { providerID, modelID }
}

async function validateAgent(client: OpenCodeClient, directory: string, name?: string, server?: string) {
  if (!name) return
  const agents = await loadRunAgents(client, directory).catch(() => undefined)
  if (!agents) {
    warning(`failed to list agents${server ? ` from ${server}` : ""}. Falling back to default agent`)
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

async function selectSession(client: OpenCodeClient, directory: string, input: RunCommandInput) {
  const selected = input.session
    ? await client.session.get({ sessionID: input.session }).catch(() => undefined)
    : input.continue
      ? await client.session
          .list({ directory, parentID: null, limit: 1, order: "desc" })
          .then((result) => result.data[0])
      : undefined
  if (input.session && !selected) fail("Session not found")
  if (!selected || !input.fork) return selected
  return client.session.fork({ sessionID: selected.id })
}

async function prepareFile(input: string, directory: string, remote: boolean): Promise<FilePart> {
  const file = path.resolve(directory, input)
  const handle = await open(file, "r").catch(() => fail(`File not found: ${input}`))
  try {
    const stat = await handle.stat()
    if (remote && stat.isDirectory()) fail(`Cannot attach local directory without a shared filesystem: ${input}`)
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

async function renderTool(part: ToolPart) {
  const info = toolInlineInfo(part)
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

async function renderToolError(part: ToolPart) {
  const info = toolInlineInfo(part)
  UI.println(UI.Style.TEXT_NORMAL + "✗", UI.Style.TEXT_NORMAL + `${info.title} failed`)
}

function warning(message: string) {
  UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL, message)
}

function reportError(input: RunCommandInput, message: string, sessionID?: string) {
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
