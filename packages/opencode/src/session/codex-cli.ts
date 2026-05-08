import { InstallationVersion } from "@/installation/version"
import type { MessageV2 } from "./message-v2"
import { PartID } from "./schema"
import type { Provider } from "@/provider"
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

type RpcID = number | string

type RpcResponse = {
  id: RpcID
  result?: unknown
  error?: { message?: string; code?: number }
}

type RpcRequest = {
  id: RpcID
  method: string
  params?: Record<string, unknown>
}

type RpcNotification = {
  method: string
  params?: Record<string, unknown>
}

type PatchFile = {
  filePath: string
  relativePath: string
  type: "add" | "update" | "delete" | "move"
  diff: string
  additions: number
  deletions: number
  movePath?: string
}

type Input = {
  assistant: MessageV2.Assistant
  abort?: AbortSignal
  cwd: string
  root: string
  historyItems: Json[]
  userInput: UserInput[]
  model: Provider.Model
  outputSchema?: Record<string, unknown>
  system: string[]
  updateMessage: (message: MessageV2.Assistant) => Promise<void>
  updatePart: (part: MessageV2.Part) => Promise<void>
  updatePartDelta: (part: MessageV2.Part, field: string, delta: string) => Promise<void>
}

type UserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }

type ResponseContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "output_text"; text: string }

type Item = {
  id?: unknown
  type?: unknown
  text?: unknown
  content?: unknown
  summary?: unknown
  command?: unknown
  cwd?: unknown
  status?: unknown
  aggregatedOutput?: unknown
  exitCode?: unknown
  durationMs?: unknown
  changes?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function object(value: unknown) {
  return isObject(value) ? value : undefined
}

function countChanges(diff: string) {
  return diff.split("\n").reduce(
    (acc, line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return acc
      if (line.startsWith("+")) return { additions: acc.additions + 1, deletions: acc.deletions }
      if (line.startsWith("-")) return { additions: acc.additions, deletions: acc.deletions + 1 }
      return acc
    },
    { additions: 0, deletions: 0 },
  )
}

function relative(cwd: string, file: string) {
  if (!path.isAbsolute(file)) return file
  const rel = path.relative(cwd, file)
  return rel && !rel.startsWith("..") ? rel : file
}

function changeType(kind: unknown): PatchFile["type"] | undefined {
  const value = object(kind)
  const type = value ? string(value.type) : string(kind)
  if (type === "add" || type === "update" || type === "delete") return type
}

export function patchFiles(raw: unknown, cwd: string): PatchFile[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const value = object(item)
    if (!value) return []
    const filePath = string(value.path)
    const diff = string(value.diff) ?? ""
    const type = changeType(value.kind)
    if (!filePath || !type) return []
    const counts = countChanges(diff)
    const kind = object(value.kind)
    const movePath = kind ? string(kind.move_path) : undefined
    return [
      {
        filePath,
        relativePath: relative(cwd, filePath),
        type: movePath ? "move" : type,
        diff,
        additions: counts.additions,
        deletions: counts.deletions,
        movePath,
      },
    ]
  })
}

function itemID(item: Item) {
  return string(item.id)
}

function partText(part: MessageV2.Part) {
  if (part.type === "text" && part.ignored) return
  if (part.type === "text") return part.text
  if (part.type === "reasoning") return `[reasoning]\n${part.text}`
  if (part.type !== "tool") return
  const input = JSON.stringify(part.state.input)
  if (part.state.status === "completed") {
    return [`[tool:${part.tool}]`, input ? `input: ${input}` : undefined, part.state.output].filter(Boolean).join("\n")
  }
  if (part.state.status === "error") {
    return [`[tool:${part.tool}:error]`, input ? `input: ${input}` : undefined, part.state.error]
      .filter(Boolean)
      .join("\n")
  }
}

function promptFromMessage(message: MessageV2.WithParts) {
  return message.parts
    .map(partText)
    .filter((part): part is string => !!part?.trim())
    .join("\n\n")
}

function inputContentFromMessage(message: MessageV2.WithParts): ResponseContent[] {
  const text = promptFromMessage(message)
  const content: ResponseContent[] = text ? [{ type: "input_text", text }] : []
  return content.concat(
    message.parts.flatMap((part): ResponseContent[] => {
      if (part.type !== "file" || !part.mime.startsWith("image/")) return []
      if (part.url.startsWith("file://")) {
        return [
          {
            type: "input_text" as const,
            text: `[Attached local image: ${part.filename ?? fileURLToPath(part.url)}]`,
          },
        ]
      }
      return [{ type: "input_image" as const, image_url: part.url }]
    }),
  )
}

export function responseItemsFromMessages(messages: MessageV2.WithParts[]): Json[] {
  return messages.flatMap((message): Json[] => {
    if (message.info.role === "user") {
      const content = inputContentFromMessage(message)
      if (content.length === 0) return []
      return [{ type: "message", role: "user", content }]
    }

    const text = promptFromMessage(message)
    if (!text) return []
    return [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }]
  })
}

export function inputFromMessage(message: MessageV2.WithParts): UserInput[] {
  const text = promptFromMessage(message)
  const input: UserInput[] = [
    ...(text ? [{ type: "text" as const, text, text_elements: [] as [] }] : []),
    ...message.parts.flatMap((part): UserInput[] => {
      if (part.type !== "file" || !part.mime.startsWith("image/")) return []
      if (part.url.startsWith("file://")) return [{ type: "localImage" as const, path: fileURLToPath(part.url) }]
      return [{ type: "image" as const, url: part.url }]
    }),
  ]
  if (input.length > 0) return input
  return [{ type: "text", text: "", text_elements: [] }]
}

function findThreadID(value: unknown): string | undefined {
  const result = object(value)
  if (!result) return
  const direct = string(result.threadId) ?? string(result.threadID) ?? string(result.id)
  if (direct) return direct
  return findThreadID(result.thread)
}

function rpcErrorMessage(value: unknown) {
  const error = object(value)
  return string(error?.message) ?? "Codex app-server request failed"
}

function parseLine(line: string) {
  try {
    const parsed = JSON.parse(line) as unknown
    return isObject(parsed) ? parsed : undefined
  } catch {
    return
  }
}

function toolStatus(status: unknown) {
  if (status === "failed" || status === "declined") return "error" as const
  return "completed" as const
}

function nvmBins() {
  const root = process.env.NVM_DIR ?? (process.env.HOME ? path.join(process.env.HOME, ".nvm") : undefined)
  if (!root) return []
  try {
    return readdirSync(path.join(root, "versions", "node"), { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => path.join(root, "versions", "node", item.name, "bin"))
      .toSorted((a, b) => b.localeCompare(a))
  } catch {
    return []
  }
}

function resolveCommand(configured: string | undefined) {
  if (configured) return configured
  return (
    [
      process.env.CODEX_BINARY,
      process.env.NVM_BIN ? path.join(process.env.NVM_BIN, "codex") : undefined,
      ...nvmBins().map((dir) => path.join(dir, "codex")),
      process.env.HOME ? path.join(process.env.HOME, ".local", "bin", "codex") : undefined,
    ].find((item) => item && existsSync(item)) ?? "codex"
  )
}

function envOverrides(value: unknown) {
  const env = object(value)
  if (!env) return {}
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function pathWithCommand(command: string, env: Record<string, string | undefined>) {
  const dirs = [
    command.includes(path.sep) ? path.dirname(command) : undefined,
    process.env.NVM_BIN,
    ...nvmBins(),
    process.env.HOME ? path.join(process.env.HOME, ".local", "bin") : undefined,
  ].filter((item): item is string => !!item)
  return [...new Set(dirs), env.PATH ?? process.env.PATH ?? ""].filter(Boolean).join(path.delimiter)
}

function modelProvider(model: Provider.Model) {
  const configured = string(model.options.modelProvider)
  if (configured) return configured
  if (model.providerID === "codex-cli" || model.api.id.startsWith("gpt-") || model.api.id.includes("codex"))
    return "openai"
  return model.providerID
}

function reasoningEffort(model: Provider.Model) {
  const effort = string(model.options.reasoningEffort)
  if (effort) return effort
  const reasoning = object(model.options.reasoning)
  return string(reasoning?.effort)
}

function serviceTier(model: Provider.Model) {
  const tier = string(model.options.serviceTier)
  if (tier === "fast" || tier === "flex") return tier
  if (tier === "priority") return "fast"
}

function threadParams(input: Input) {
  return {
    cwd: input.cwd,
    model: input.model.api.id,
    modelProvider: modelProvider(input.model),
    approvalPolicy: string(input.model.options.approvalPolicy) ?? "never",
    sandbox: string(input.model.options.sandbox) ?? "workspace-write",
    serviceTier: serviceTier(input.model) ?? null,
    developerInstructions: input.system.join("\n\n") || null,
    ephemeral: true,
  }
}

export async function run(input: Input) {
  if (input.abort?.aborted) throw new Error("Codex app-server run aborted")
  const command = resolveCommand(string(input.model.options.command))
  const args = Array.isArray(input.model.options.args)
    ? input.model.options.args.filter((item): item is string => typeof item === "string")
    : ["app-server", "--listen", "stdio://"]
  const env = { ...process.env, ...envOverrides(input.model.options.env) }
  const child = spawn(command, args, {
    cwd: input.cwd,
    env: { ...env, PATH: pathWithCommand(command, env) },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const lineReader = readline.createInterface({ input: child.stdout })
  const pending = new Map<RpcID, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const textParts = new Map<string, MessageV2.TextPart>()
  const reasoningParts = new Map<string, MessageV2.ReasoningPart>()
  const toolParts = new Map<string, MessageV2.ToolPart>()
  let nextID = 1
  let threadID: string | undefined
  let turnFinished: (() => void) | undefined
  let turnFailed: ((error: Error) => void) | undefined
  let abortHandler: (() => void) | undefined

  const send = (message: Json) => child.stdin.write(JSON.stringify(message) + "\n")
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextID++
      pending.set(id, { resolve, reject })
      send({ id, method, params } as Json)
    })

  const ensureTextPart = async (id: string) => {
    const existing = textParts.get(id)
    if (existing) return existing
    const part: MessageV2.TextPart = {
      id: PartID.ascending(),
      sessionID: input.assistant.sessionID,
      messageID: input.assistant.id,
      type: "text",
      text: "",
      time: { start: Date.now() },
      metadata: { codexItemID: id },
    }
    textParts.set(id, part)
    await input.updatePart(part)
    return part
  }

  const ensureReasoningPart = async (id: string) => {
    const existing = reasoningParts.get(id)
    if (existing) return existing
    const part: MessageV2.ReasoningPart = {
      id: PartID.ascending(),
      sessionID: input.assistant.sessionID,
      messageID: input.assistant.id,
      type: "reasoning",
      text: "",
      time: { start: Date.now() },
      metadata: { codexItemID: id },
    }
    reasoningParts.set(id, part)
    await input.updatePart(part)
    return part
  }

  const updateTextDelta = async (params: Record<string, unknown>) => {
    const id = string(params.itemId)
    const delta = string(params.delta)
    if (!id || !delta) return
    const part = await ensureTextPart(id)
    part.text += delta
    await input.updatePartDelta(part, "text", delta)
  }

  const updateReasoningDelta = async (params: Record<string, unknown>) => {
    const id = string(params.itemId)
    const delta = string(params.delta)
    if (!id || !delta) return
    const part = await ensureReasoningPart(id)
    part.text += delta
    await input.updatePartDelta(part, "text", delta)
  }

  const updateCommandOutput = async (params: Record<string, unknown>) => {
    const id = string(params.itemId)
    const delta = string(params.delta)
    if (!id || !delta) return
    const part = toolParts.get(id)
    if (!part || part.state.status !== "running") return
    const output = string(part.state.metadata?.output) ?? ""
    part.state.metadata = { ...part.state.metadata, output: output + delta }
    await input.updatePart(part)
  }

  const updateFileChange = async (params: Record<string, unknown>) => {
    const id = string(params.itemId)
    if (!id) return
    const files = patchFiles(params.changes, input.cwd)
    const existing = toolParts.get(id)
    if (existing) {
      existing.metadata = { ...existing.metadata, files }
      if (existing.state.status === "running") existing.state.metadata = { ...existing.state.metadata, files }
      await input.updatePart(existing)
      return
    }
    const part: MessageV2.ToolPart = {
      id: PartID.ascending(),
      sessionID: input.assistant.sessionID,
      messageID: input.assistant.id,
      type: "tool",
      tool: "apply_patch",
      callID: id,
      metadata: { codexItemID: id, files },
      state: {
        status: "running",
        input: { files: files.map((file) => file.relativePath) },
        metadata: { files },
        time: { start: Date.now() },
      },
    }
    toolParts.set(id, part)
    await input.updatePart(part)
  }

  const startItem = async (item: Item) => {
    const id = itemID(item)
    if (!id) return
    if (item.type === "commandExecution") {
      const part: MessageV2.ToolPart = {
        id: PartID.ascending(),
        sessionID: input.assistant.sessionID,
        messageID: input.assistant.id,
        type: "tool",
        tool: "bash",
        callID: id,
        metadata: { codexItemID: id },
        state: {
          status: "running",
          input: { command: string(item.command) ?? "", cwd: string(item.cwd) },
          metadata: { output: "", description: "" },
          time: { start: Date.now() },
        },
      }
      toolParts.set(id, part)
      await input.updatePart(part)
      return
    }
    if (item.type === "fileChange") await updateFileChange({ itemId: id, changes: item.changes })
  }

  const completeItem = async (item: Item, completedAtMs: number | undefined) => {
    const id = itemID(item)
    if (!id) return
    if (item.type === "agentMessage") {
      const part = await ensureTextPart(id)
      const text = string(item.text)
      if (text !== undefined && text !== part.text) part.text = text
      part.time = { start: part.time?.start ?? Date.now(), end: completedAtMs ?? Date.now() }
      await input.updatePart(part)
      return
    }
    if (item.type === "reasoning") {
      const part = await ensureReasoningPart(id)
      const content = Array.isArray(item.summary)
        ? item.summary.filter((entry): entry is string => typeof entry === "string").join("\n")
        : Array.isArray(item.content)
          ? item.content.filter((entry): entry is string => typeof entry === "string").join("\n")
          : undefined
      if (content !== undefined && content !== part.text) part.text = content
      part.time = { ...part.time, end: completedAtMs ?? Date.now() }
      await input.updatePart(part)
      return
    }
    if (item.type === "commandExecution") {
      const part = toolParts.get(id)
      if (!part) return
      const output =
        string(item.aggregatedOutput) ??
        string("metadata" in part.state ? part.state.metadata?.output : undefined) ??
        ""
      const inputValue = part.state.input
      const start = "time" in part.state ? part.state.time.start : Date.now()
      if (toolStatus(item.status) === "error") {
        part.state = {
          status: "error",
          input: inputValue,
          error: output || `Command ${string(item.status) ?? "failed"}`,
          metadata: { output, exitCode: item.exitCode, durationMs: item.durationMs },
          time: { start, end: completedAtMs ?? Date.now() },
        }
      } else {
        part.state = {
          status: "completed",
          input: inputValue,
          output,
          title: "",
          metadata: { output, exitCode: item.exitCode, durationMs: item.durationMs },
          time: { start, end: completedAtMs ?? Date.now() },
        }
      }
      await input.updatePart(part)
      return
    }
    if (item.type === "fileChange") {
      await updateFileChange({ itemId: id, changes: item.changes })
      const part = toolParts.get(id)
      if (!part) return
      const files = patchFiles(item.changes, input.cwd)
      part.metadata = { ...part.metadata, files }
      part.state = {
        status: toolStatus(item.status) === "error" ? "error" : "completed",
        input: { files: files.map((file) => file.relativePath) },
        ...(toolStatus(item.status) === "error"
          ? { error: `Patch ${string(item.status) ?? "failed"}` }
          : { output: "", title: "" }),
        metadata: { files },
        time: {
          start: "time" in part.state ? part.state.time.start : Date.now(),
          end: completedAtMs ?? Date.now(),
        },
      } as MessageV2.ToolState
      await input.updatePart(part)
    }
  }

  const handleNotification = async (message: RpcNotification) => {
    const params = object(message.params) ?? {}
    if (message.method === "thread/started") {
      threadID = findThreadID(params)
      return
    }
    if (message.method === "item/agentMessage/delta") return updateTextDelta(params)
    if (message.method === "item/reasoning/textDelta" || message.method === "item/reasoning/summaryTextDelta") {
      return updateReasoningDelta(params)
    }
    if (message.method === "item/commandExecution/outputDelta") return updateCommandOutput(params)
    if (message.method === "item/fileChange/patchUpdated") return updateFileChange(params)
    if (message.method === "item/started") return startItem((object(params.item) ?? {}) as Item)
    if (message.method === "item/completed")
      return completeItem((object(params.item) ?? {}) as Item, number(params.completedAtMs))
    if (message.method === "turn/completed") {
      const turn = object(params.turn)
      const status = string(turn?.status)
      input.assistant.finish = status === "failed" ? "error" : "stop"
      input.assistant.time.completed = Date.now()
      await input.updateMessage(input.assistant)
      turnFinished?.()
      return
    }
    if (message.method === "error") {
      turnFailed?.(new Error(string(object(params.error)?.message) ?? "Codex app-server failed"))
    }
  }

  const handleServerRequest = (message: RpcRequest) => {
    if (message.method === "item/commandExecution/requestApproval") {
      send({ id: message.id, result: { decision: "decline" } })
      return
    }
    if (message.method === "item/fileChange/requestApproval") {
      send({ id: message.id, result: { decision: "decline" } })
      return
    }
    if (message.method === "item/permissions/requestApproval") {
      send({ id: message.id, result: { permissions: {}, scope: "turn" } })
      return
    }
    if (message.method === "applyPatchApproval" || message.method === "execCommandApproval") {
      send({ id: message.id, result: { decision: "denied" } })
      return
    }
    if (message.method === "item/tool/requestUserInput") {
      send({ id: message.id, result: { answers: {} } })
      return
    }
    if (message.method === "mcpServer/elicitation/request") {
      send({ id: message.id, result: { action: "decline", content: null, _meta: null } })
      return
    }
    if (message.method === "item/tool/call") {
      send({ id: message.id, result: { contentItems: [], success: false } })
      return
    }
    if (message.method === "account/chatgptAuthTokens/refresh") {
      send({
        id: message.id,
        error: {
          code: -32603,
          message: "Codex auth token refresh is not available through the OpenCode Codex bridge. Run `codex login`.",
        },
      })
      return
    }
    send({
      id: message.id,
      error: { code: -32601, message: `Unsupported Codex app-server request: ${message.method}` },
    })
  }

  const closed = new Promise<never>((_, reject) => {
    child.once("error", (error) => reject(error))
    child.once("exit", (code, signal) => reject(new Error(`Codex app-server exited (${signal ?? code ?? "unknown"})`)))
  })
  const aborted = new Promise<never>((_, reject) => {
    if (!input.abort) return
    abortHandler = () => {
      child.kill("SIGTERM")
      reject(new Error("Codex app-server run aborted"))
    }
    input.abort.addEventListener("abort", abortHandler, { once: true })
  })

  lineReader.on("line", (line) => {
    const parsed = parseLine(line)
    if (!parsed) return
    if ("id" in parsed && ("result" in parsed || "error" in parsed) && !("method" in parsed)) {
      const response = parsed as RpcResponse
      const waiter = pending.get(response.id)
      if (!waiter) return
      pending.delete(response.id)
      if (response.error) waiter.reject(new Error(rpcErrorMessage(response.error)))
      else waiter.resolve(response.result)
      return
    }
    if (typeof parsed.method !== "string") return
    if ("id" in parsed) {
      handleServerRequest(parsed as RpcRequest)
      return
    }
    void handleNotification(parsed as RpcNotification)
  })

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (!text) return
    // Codex logs to stderr. Surface it only in process logs, not chat output.
    console.debug(`[codex-cli] ${text}`)
  })

  try {
    await Promise.race([
      request("initialize", {
        clientInfo: { name: "opencode", version: InstallationVersion },
        capabilities: { experimentalApi: true },
      }),
      closed,
      aborted,
    ])
    send({ method: "initialized" })
    const thread = await Promise.race([
      request("thread/start", { ...threadParams(input), sessionStartSource: "startup", threadSource: "user" }),
      closed,
      aborted,
    ])
    threadID = findThreadID(thread) ?? threadID
    if (!threadID) throw new Error("Codex app-server did not return a thread id")
    if (input.historyItems.length > 0) {
      await Promise.race([
        request("thread/inject_items", { threadId: threadID, items: input.historyItems }),
        closed,
        aborted,
      ])
    }
    await Promise.race([
      request("turn/start", {
        threadId: threadID,
        input: input.userInput,
        model: input.model.api.id,
        effort: reasoningEffort(input.model) ?? null,
        serviceTier: serviceTier(input.model) ?? null,
        outputSchema: input.outputSchema ?? null,
      }),
      closed,
      aborted,
    ])
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        turnFinished = resolve
        turnFailed = reject
      }),
      closed,
      aborted,
    ])
  } finally {
    if (input.abort && abortHandler) input.abort.removeEventListener("abort", abortHandler)
    for (const waiter of pending.values()) waiter.reject(new Error("Codex app-server stopped"))
    pending.clear()
    lineReader.close()
    if (!child.killed) child.kill("SIGTERM")
  }
}

export * as SessionCodexCli from "./codex-cli"
