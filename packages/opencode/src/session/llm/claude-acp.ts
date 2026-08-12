import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ClientSideConnection, PROTOCOL_VERSION, RequestError, ndJsonStream } from "@agentclientprotocol/sdk"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type {
  Client,
  CreateElicitationRequest,
  CreateElicitationResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  ElicitationContentValue,
  ElicitationPropertySchema,
  KillTerminalRequest,
  KillTerminalResponse,
  McpServer,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import { LLMEvent, ToolResultValue, Usage, type FinishReason, type LLMEvent as LLMEventType } from "@opencode-ai/llm"
import { Question } from "@/question"
import type { ModelMessage } from "ai"
import { createTwoFilesPatch } from "diff"
import * as Stream from "effect/Stream"

type PermissionBridge = {
  readonly ask: (input: PermissionV1.AskInput) => Promise<PermissionV1.Reply>
  readonly reply: (input: PermissionV1.ReplyInput) => Promise<void>
}

type QuestionBridge = {
  readonly ask: (input: Parameters<Question.Interface["ask"]>[0]) => Promise<ReadonlyArray<Question.Answer>>
}

export type ClaudeACPConfigState = {
  readonly effort?: string
  readonly fast?: boolean
}

type StreamInput = {
  readonly cwd: string
  readonly sessionID: PermissionV1.AskInput["sessionID"]
  readonly modelID: string
  readonly agent: string
  readonly mcpServers: readonly McpServer[]
  readonly messages: ModelMessage[]
  readonly abort: AbortSignal
  readonly ruleset: PermissionV1.Ruleset
  readonly permission: PermissionBridge
  readonly question: QuestionBridge
  readonly onConfig?: (config: ClaudeACPConfigState) => Promise<void>
}

type Terminal = {
  readonly process: Bun.Subprocess<"ignore", "pipe", "pipe">
  readonly output: string[]
  readonly limit: number
  truncated: boolean
  readonly exited: Promise<WaitForTerminalExitResponse>
  exitStatus?: WaitForTerminalExitResponse
}

type ACPToolState = {
  name: string
  title: string
  input: unknown
  content?: ToolCallContent[] | null
  rawOutput?: unknown
  status?: ToolCall["status"] | null
  started: boolean
}

type QueueItem =
  | { readonly type: "event"; readonly event: LLMEventType }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly error: unknown }

type ACPUsage = {
  readonly cachedReadTokens?: number | null
  readonly cachedWriteTokens?: number | null
  readonly inputTokens: number
  readonly outputTokens: number
  readonly thoughtTokens?: number | null
  readonly totalTokens: number
}

type ACPContextUsage = {
  readonly used: number
  readonly size: number
}

type ACPProviderMetadata = {
  readonly anthropic: Record<string, unknown>
}

type ElicitationField = {
  readonly key: string
  readonly question: Question.Info
  readonly value: (answers: ReadonlyArray<string>) => ElicitationContentValue | undefined
}

type Connection = {
  readonly key: string
  readonly cwd: string
  readonly child: Bun.Subprocess<"pipe", "pipe", "pipe">
  client: ClientSideConnection
  readonly stderr: string[]
  readonly terminals: Map<string, Terminal>
  sessionID: string
  configOptions: SessionConfigOption[]
  lock: Promise<void>
  used: boolean
  disposed: boolean
  active?: {
    readonly cwd: string
    readonly queue: ReturnType<typeof makeQueue>
    readonly sessionID: PermissionV1.AskInput["sessionID"]
    readonly abort: AbortSignal
    readonly ruleset: PermissionV1.Ruleset
    readonly permission: PermissionBridge
    readonly question: QuestionBridge
    readonly tools: Map<string, ACPToolState>
    contextUsage?: ACPContextUsage
    providerCompacted?: boolean
  }
  disposeTimer?: ReturnType<typeof setTimeout>
}

type ActivePermissionRequest = {
  readonly sessionID: PermissionV1.AskInput["sessionID"]
  readonly abort: AbortSignal
  readonly ruleset: PermissionV1.Ruleset
  readonly permission: PermissionBridge
}

type ActiveDirectRequest = ActivePermissionRequest & {
  readonly cwd: string
}

type DirectPermissionCheck = Pick<PermissionV1.AskInput, "permission" | "patterns" | "always" | "metadata">

type DirectPermissionInput =
  | {
      readonly kind: "read" | "write"
      readonly cwd: string
      readonly path: string
    }
  | {
      readonly kind: "terminal"
      readonly cwd: string
      readonly command: string
      readonly args?: readonly string[] | null
      readonly terminalCwd?: string | null
    }

const TEXT_ID = "claude-acp-text"
const REASONING_ID = "claude-acp-reasoning"
const IDLE_CLOSE_MS = 10 * 60_000
const TERMINAL_OUTPUT_DEFAULT = 128_000
const TERMINAL_OUTPUT_MAX = 1_000_000
const connections = new Map<string, Promise<Connection>>()
const activeConnections = new Set<Connection>()

process.once("exit", () => {
  for (const connection of activeConnections) {
    cleanupTerminals(connection)
    connection.child.kill()
  }
})

export function stream(input: StreamInput): Stream.Stream<LLMEventType, unknown> {
  return Stream.fromAsyncIterable(run(input), (error) =>
    error instanceof Error ? error : new Error(String(error)),
  )
}

async function* run(input: StreamInput) {
  const queue = makeQueue()
  let connection: Connection | undefined
  let finished = false
  const onAbort = () => {
    if (!connection) return
    void connection.client.cancel({ sessionId: connection.sessionID }).catch(() => undefined)
  }
  input.abort.addEventListener("abort", onAbort, { once: true })

  void (async () => {
    try {
      queue.push(LLMEvent.stepStart({ index: 0 }))
      const activeConnection = await getConnection(input)
      connection = activeConnection
      await withConnectionLock(activeConnection, async () => {
        if (input.abort.aborted) {
          finish(queue, "error")
          return
        }
        clearDisposeTimer(activeConnection)
        activeConnection.stderr.length = 0
        activeConnection.active = {
          cwd: input.cwd,
          queue,
          sessionID: input.sessionID,
          abort: input.abort,
          ruleset: input.ruleset,
          permission: input.permission,
          question: input.question,
          tools: new Map(),
        }
        try {
          await publishConfig(input, activeConnection)
          const commandText = currentPromptText(input.messages)
          const command = claudeACPConfigCommand(commandText)
          if (command) {
            const message = await applyConfigCommand(activeConnection, command)
            await publishConfig(input, activeConnection)
            activeConnection.active?.queue.text(message)
            finish(queue, "stop")
            return
          }
          const response = await activeConnection.client.prompt({
            sessionId: activeConnection.sessionID,
            prompt: [
              {
                type: "text",
                text: activeConnection.used ? commandText : promptText(input.messages),
              },
            ],
          })
          activeConnection.used = true
          await new Promise((resolve) => setTimeout(resolve, 50))
          if (input.abort.aborted) {
            finish(
              queue,
              "error",
              claudeUsage(response.usage, activeConnection.active?.contextUsage) ??
                claudeContextUsage(activeConnection.active?.contextUsage),
              claudeProviderMetadata(activeConnection.active?.providerCompacted),
            )
            return
          }
          finish(
            queue,
            finishReason(response.stopReason),
            claudeUsage(response.usage, activeConnection.active?.contextUsage),
            claudeProviderMetadata(activeConnection.active?.providerCompacted),
          )
        } finally {
          const providerCompacted = activeConnection.active?.providerCompacted === true
          activeConnection.active = undefined
          cleanupTerminals(activeConnection)
          // OpenCode compaction rewrites our stored history, but Claude Code keeps its own ACP session history.
          // Start the next turn in a fresh Claude session so it is seeded from the compacted transcript.
          if (input.agent === "compaction" || providerCompacted) disposeConnection(activeConnection)
          else scheduleDispose(activeConnection)
        }
      })
    } catch (error) {
      if (connection) {
        const usage = claudeContextUsage(connection.active?.contextUsage)
        const providerMetadata = claudeProviderMetadata(connection.active?.providerCompacted)
        const aborted = input.abort.aborted
        connection.active = undefined
        cleanupTerminals(connection)
        if (aborted) {
          scheduleDispose(connection)
          finish(queue, "error", usage, providerMetadata)
          return
        }
        disposeConnection(connection)
      }
      if (input.abort.aborted) {
        finish(queue, "error")
        return
      }
      const message = connection?.stderr.join("").trim()
      queue.fail(message ? new Error(`${errorMessage(error)}\n${message}`) : error)
    }
  })()

  try {
    for await (const event of queue) {
      finished = event.type === "finish"
      yield event
    }
  } finally {
    input.abort.removeEventListener("abort", onAbort)
    if (connection && !finished) {
      await connection.client.cancel({ sessionId: connection.sessionID }).catch(() => undefined)
      disposeConnection(connection)
    }
  }
}

async function getConnection(input: StreamInput) {
  const key = claudeACPConnectionKey(input)
  const existing = connections.get(key)
  if (existing) {
    const connection = await existing
    if (!connection.disposed) return connection
    connections.delete(key)
  }
  const created = createConnection(input, key).catch((error) => {
    connections.delete(key)
    throw error
  })
  connections.set(key, created)
  return created
}

async function createConnection(input: StreamInput, key: string): Promise<Connection> {
  if (input.abort.aborted) throw abortError()
  const stderr: string[] = []
  const terminals = new Map<string, Terminal>()
  const child = Bun.spawn({
    cmd: claudeCommand(),
    cwd: input.cwd,
    env: claudeEnv(input.modelID),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const connection = {
    key,
    cwd: input.cwd,
    child,
    stderr,
    terminals,
    sessionID: "",
    configOptions: [] as SessionConfigOption[],
    lock: Promise.resolve(),
    used: false,
    disposed: false,
  } as unknown as Connection
  activeConnections.add(connection)
  connection.client = new ClientSideConnection(
    () => makeClient(connection),
    ndJsonStream(writable(child.stdin), child.stdout),
  )
  void collect(child.stderr, stderr, 32_000)
  const onAbort = () => disposeConnection(connection)
  input.abort.addEventListener("abort", onAbort, { once: true })
  void child.exited.finally(() => {
    if (connection.disposed) return
    connection.disposed = true
    activeConnections.delete(connection)
    connections.delete(connection.key)
  })
  try {
    await connection.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "OpenCode", version: "0.0.0" },
      clientCapabilities: {
        auth: { terminal: true },
        elicitation: { form: {} },
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    })
    if (input.abort.aborted) throw abortError()
    const session = await connection.client.newSession({ cwd: input.cwd, mcpServers: [...input.mcpServers] })
    if (input.abort.aborted) throw abortError()
    connection.sessionID = session.sessionId
    connection.configOptions = session.configOptions ?? []
    scheduleDispose(connection)
    return connection
  } catch (error) {
    disposeConnection(connection)
    throw error
  } finally {
    input.abort.removeEventListener("abort", onAbort)
  }
}

async function withConnectionLock<T>(connection: Connection, fn: () => Promise<T>) {
  const previous = connection.lock.catch(() => undefined)
  let release!: () => void
  connection.lock = previous.then(() => new Promise<void>((resolve) => (release = resolve)))
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

export function claudeACPConnectionKey(
  input: Pick<StreamInput, "sessionID" | "cwd" | "modelID" | "agent" | "mcpServers" | "messages">,
) {
  return [
    input.sessionID,
    input.cwd,
    input.modelID,
    input.agent,
    stableStringify(input.mcpServers),
    stableStringify(input.messages.filter((message) => message.role === "system").map((message) => contentText(message.content))),
  ].join("\0")
}

function scheduleDispose(connection: Connection) {
  if (connection.disposed) return
  clearDisposeTimer(connection)
  connection.disposeTimer = setTimeout(() => disposeConnection(connection), IDLE_CLOSE_MS)
  connection.disposeTimer.unref?.()
}

function clearDisposeTimer(connection: Connection) {
  if (!connection.disposeTimer) return
  clearTimeout(connection.disposeTimer)
  connection.disposeTimer = undefined
}

function disposeConnection(connection: Connection) {
  if (connection.disposed) return
  connection.disposed = true
  clearDisposeTimer(connection)
  activeConnections.delete(connection)
  connections.delete(connection.key)
  cleanupTerminals(connection)
  if (connection.sessionID) void connection.client.closeSession({ sessionId: connection.sessionID }).catch(() => undefined)
  connection.child.kill()
  void Promise.allSettled([connection.client.closed, connection.child.exited])
}

function cleanupTerminals(connection: Connection) {
  for (const terminal of connection.terminals.values()) terminal.process.kill()
  connection.terminals.clear()
}

function claudeCommand() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  return ["node", path.join(root, "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "index.js")]
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.trim() === "Authentication required") {
    return "Claude Code authentication required. Run `claude auth login` in a normal terminal, then retry in OpenCode."
  }
  return message
}

function abortError() {
  return new DOMException("Aborted", "AbortError")
}

function claudeEnv(modelID: string) {
  const selected = claudeModelID(modelID)
  if (!selected) return process.env
  return {
    ...process.env,
    ANTHROPIC_MODEL: selected,
  }
}

export type ClaudeACPConfigCommand = {
  readonly configId: "effort" | "model" | "fast"
  readonly value?: string
}

/** Claude Code disables /effort under ACP/SDK; OpenCode handles these locally via setSessionConfigOption. */
export function claudeACPConfigCommand(text: string): ClaudeACPConfigCommand | undefined {
  const match = text.trim().match(/^\/(effort|model|fast)(?:\s+(\S+))?\s*$/i)
  if (!match) return
  return {
    configId: match[1].toLowerCase() as ClaudeACPConfigCommand["configId"],
    value: match[2]?.toLowerCase(),
  }
}

export function claudeACPConfigOptionValues(option: SessionConfigOption | undefined) {
  if (!option) return []
  if (option.type === "boolean") return ["on", "off"]
  if (option.type !== "select" || !Array.isArray(option.options)) return []
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry])).map((entry) => entry.value)
}

export function claudeACPConfigOptionCurrent(option: SessionConfigOption | undefined) {
  if (!option) return
  if (option.type === "boolean") return option.currentValue ? "on" : "off"
  if (typeof option.currentValue === "string") return option.currentValue
}

export function claudeACPConfigState(configOptions: readonly SessionConfigOption[]): ClaudeACPConfigState {
  const effort = claudeACPConfigOptionCurrent(configOptions.find((item) => item.id === "effort"))
  const fast = claudeACPConfigOptionCurrent(configOptions.find((item) => item.id === "fast"))
  return {
    ...(effort ? { effort } : {}),
    ...(fast !== undefined ? { fast: fast === "on" } : {}),
  }
}

async function publishConfig(input: StreamInput, connection: Connection) {
  if (!input.onConfig) return
  await input.onConfig(claudeACPConfigState(connection.configOptions))
}

async function applyConfigCommand(connection: Connection, command: ClaudeACPConfigCommand) {
  if (command.configId === "fast") return applyFastCommand(connection, command.value)

  const option = connection.configOptions.find((item) => item.id === command.configId)
  if (!option) {
    return `${labelForConfig(command.configId)} isn't available for the current Claude Code session.`
  }

  const current = claudeACPConfigOptionCurrent(option)
  const allowed = claudeACPConfigOptionValues(option)
  if (!command.value) {
    const choices = allowed.length > 0 ? allowed.join(", ") : "unknown"
    return `${labelForConfig(command.configId)} is currently ${current ?? "unset"}. Available: ${choices}`
  }

  const value = resolveConfigValue(command, allowed)
  if (!value) {
    return `Invalid ${command.configId} value "${command.value}". Available: ${allowed.join(", ") || "none"}`
  }
  if (value === current) return `${labelForConfig(command.configId)} is already ${value}`

  await setConfigOption(connection, command.configId, value, option)
  const next = claudeACPConfigOptionCurrent(connection.configOptions.find((item) => item.id === command.configId))
  return `${labelForConfig(command.configId)} set to ${next ?? value}`
}

async function applyFastCommand(connection: Connection, raw?: string) {
  const current = () => claudeACPConfigOptionCurrent(configOption(connection, "fast"))
  const desired = resolveFastDesired(raw, current())
  if (desired === "invalid") {
    return `Invalid fast value "${raw}". Use on, off, or omit a value to toggle.`
  }

  if (desired === false) {
    const option = configOption(connection, "fast")
    if (!option || current() !== "on") return "Fast mode OFF"
    await setConfigOption(connection, "fast", "off", option)
    return "Fast mode OFF"
  }

  // Claude Code switches to Opus when enabling fast mode on an unsupported model.
  let option = configOption(connection, "fast")
  if (!option) {
    const model = configOption(connection, "model")
    if (!model) {
      return "Fast mode isn't available for the current Claude Code session."
    }
    await setConfigOption(connection, "model", "opus", model)
    option = configOption(connection, "fast")
    if (!option) {
      return "Switched to Opus, but Fast mode still isn't available. It may be disabled for your account or organization."
    }
  }

  if (current() === "on") return "Fast mode ON"
  await setConfigOption(connection, "fast", "on", option)
  return "Fast mode ON"
}

export function resolveFastDesired(raw: string | undefined, current: string | undefined) {
  if (!raw) return current !== "on"
  if (raw === "on" || raw === "true" || raw === "1") return true
  if (raw === "off" || raw === "false" || raw === "0") return false
  if (raw === "toggle") return current !== "on"
  return "invalid"
}

function configOption(connection: Connection, id: string) {
  return connection.configOptions.find((item) => item.id === id)
}

function resolveConfigValue(command: ClaudeACPConfigCommand, allowed: string[]) {
  if (!command.value) return
  if (allowed.includes(command.value)) return command.value
  // Model aliases are resolved by Claude ACP when the exact ID is absent.
  if (command.configId === "model") return command.value
}

function labelForConfig(configId: ClaudeACPConfigCommand["configId"]) {
  if (configId === "effort") return "Effort"
  if (configId === "model") return "Model"
  return "Fast mode"
}

async function setConfigOption(
  connection: Connection,
  configId: string,
  value: string,
  option: SessionConfigOption,
) {
  if (option.type === "boolean") {
    const response = await connection.client.setSessionConfigOption({
      sessionId: connection.sessionID,
      configId,
      type: "boolean",
      value: value === "on",
    })
    connection.configOptions = response.configOptions ?? connection.configOptions
    return
  }
  const response = await connection.client.setSessionConfigOption({
    sessionId: connection.sessionID,
    configId,
    value,
  })
  connection.configOptions = response.configOptions ?? connection.configOptions
}

function makeClient(connection: Connection): Client {
  return {
    sessionUpdate: async (params: SessionNotification) => sessionUpdate(connection, params),
    requestPermission: (params) => requestPermission(connection, params),
    unstable_createElicitation: (params) => createElicitation(connection, params),
    readTextFile: (params) => readTextFile(connection.active, connection.cwd, params),
    writeTextFile: (params) => writeTextFile(connection.active, connection.cwd, params),
    createTerminal: (params) => createTerminal(connection, params),
    terminalOutput: (params) => terminalOutput(connection.terminals, params),
    waitForTerminalExit: (params) => waitForTerminalExit(connection.terminals, params),
    killTerminal: (params) => killTerminal(connection.terminals, params),
    releaseTerminal: (params) => releaseTerminal(connection.terminals, params),
  }
}

function sessionUpdate(connection: Connection, params: SessionNotification) {
  if (params.update.sessionUpdate === "config_option_update") {
    connection.configOptions = params.update.configOptions ?? connection.configOptions
    return
  }
  const active = connection.active
  if (!active) return
  if (params.update.sessionUpdate === "usage_update") {
    const used = token(params.update.used)
    const size = token(params.update.size)
    // The adapter sends used: 0 only as a fallback when its post-compaction
    // context probe fails — never as a real measurement (the system prompt
    // alone occupies tokens) — so hold the last report instead of wiping it.
    if (!used || !size) return
    active.contextUsage = { used, size }
    // Claude Code reports context occupancy as it changes (including the drop
    // after its internal compaction) — stream it so the meter moves live.
    const usage = claudeContextUsage(active.contextUsage)
    if (usage) active.queue.push(LLMEvent.usage(usage))
    return
  }
  if (params.update.sessionUpdate === "agent_message_chunk" && params.update.content.type === "text") {
    const compaction = claudeACPCompactionStatus(params.update.content.text)
    if (compaction) {
      if (compaction === "completed") active.providerCompacted = true
      return
    }
    active.queue.text(params.update.content.text)
    return
  }
  if (params.update.sessionUpdate === "agent_thought_chunk" && params.update.content.type === "text") {
    active.queue.reasoning(params.update.content.text)
    return
  }
  if (params.update.sessionUpdate === "tool_call" || params.update.sessionUpdate === "tool_call_update") {
    const events = claudeACPToolEvents(active.tools, params.update)
    if (events.length === 0) return
    active.queue.closeBlocks()
    for (const event of events) active.queue.push(event)
  }
}

export function claudeACPToolEvents(
  state: Map<string, ACPToolState>,
  update: Extract<SessionNotification["update"], { sessionUpdate: "tool_call" | "tool_call_update" }>,
) {
  const previous = state.get(update.toolCallId)
  const tool = {
    name: claudeACPToolName(update, previous?.name),
    title: update.title ?? previous?.title ?? update.toolCallId,
    input: "rawInput" in update && update.rawInput !== undefined ? update.rawInput : (previous?.input ?? {}),
    content: update.content ?? previous?.content,
    rawOutput: "rawOutput" in update && update.rawOutput !== undefined ? update.rawOutput : previous?.rawOutput,
    status: update.status ?? previous?.status,
    started: previous?.started ?? false,
  } satisfies ACPToolState
  state.set(update.toolCallId, tool)

  const events: LLMEventType[] = []
  if (!tool.started) {
    tool.started = true
    events.push(
      LLMEvent.toolCall({
        id: update.toolCallId,
        name: tool.name,
        input: tool.input,
        providerExecuted: true,
        providerMetadata: claudeACPToolMetadata(tool, update),
      }),
    )
  }

  if (tool.status === "completed") {
    events.push(
      LLMEvent.toolResult({
        id: update.toolCallId,
        name: tool.name,
        result: ToolResultValue.make({
          title: tool.title,
          output: claudeACPToolOutput(tool),
          metadata: claudeACPToolResultMetadata(tool, update),
        }),
        providerExecuted: true,
        providerMetadata: claudeACPToolMetadata(tool, update),
      }),
    )
    state.delete(update.toolCallId)
  }

  if (tool.status === "failed") {
    events.push(
      LLMEvent.toolError({
        id: update.toolCallId,
        name: tool.name,
        message: claudeACPToolOutput(tool),
        error: tool.rawOutput,
        providerMetadata: claudeACPToolMetadata(tool, update),
      }),
    )
    state.delete(update.toolCallId)
  }

  return events
}

function claudeACPToolName(tool: Partial<Pick<ToolCall | ToolCallUpdate, "kind" | "rawInput" | "title">>, fallback?: string) {
  switch (tool.kind) {
    case "execute":
      return "bash"
    case "edit":
    case "delete":
    case "move":
      return "edit"
    case "fetch":
      return "webfetch"
    case "search":
      return "grep"
    case "read":
      return "read"
  }

  const input = recordValue(tool.rawInput)
  return (
    stringValue(input.tool) ??
    stringValue(input.toolName) ??
    stringValue(input.name) ??
    stringValue(input.command) ??
    fallback ??
    tool.kind ??
    tool.title ??
    "claude_tool"
  )
}

function claudeACPToolMetadata(
  tool: ACPToolState,
  update: Extract<SessionNotification["update"], { sessionUpdate: "tool_call" | "tool_call_update" }>,
) {
  return {
    anthropic: {
      acpTool: {
        id: update.toolCallId,
        name: tool.name,
        title: tool.title,
        status: tool.status,
        kind: update.kind,
      },
    },
  }
}

function claudeACPToolResultMetadata(
  tool: ACPToolState,
  update: Extract<SessionNotification["update"], { sessionUpdate: "tool_call" | "tool_call_update" }>,
) {
  return {
    acp: {
      status: tool.status,
      kind: update.kind,
      rawOutput: tool.rawOutput,
    },
  }
}

function claudeACPToolOutput(tool: ACPToolState) {
  if (typeof tool.rawOutput === "string") return tool.rawOutput
  const output = recordValue(tool.rawOutput).output
  if (typeof output === "string") return output
  if (tool.rawOutput !== undefined) return stringifyToolValue(tool.rawOutput)
  const content = (tool.content ?? []).map(toolContentText).filter(Boolean).join("\n")
  return content || tool.title
}

function toolContentText(content: ToolCallContent) {
  if (content.type === "diff") return `Updated ${content.path}`
  if (content.type === "terminal") return `Terminal ${content.terminalId}`
  if (content.content.type === "text") return content.content.text
  if (content.content.type === "image") return "[image]"
  return stringifyToolValue(content.content)
}

function stringifyToolValue(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

async function requestPermission(
  connection: Connection,
  params: RequestPermissionRequest,
): Promise<RequestPermissionResponse> {
  return requestPermissionForActive(connection.active, params)
}

export async function requestPermissionForActive(
  active: ActivePermissionRequest | undefined,
  params: RequestPermissionRequest,
): Promise<RequestPermissionResponse> {
  if (!active || active.abort.aborted) return cancelledPermission()

  const requestID = PermissionV1.ID.ascending()
  const permission = permissionName(params)
  const metadata = permissionMetadata(params)
  const patterns = permissionPatterns(permission, metadata, params)
  const onAbort = () => {
    void active.permission.reply({ requestID, reply: "reject" }).catch(() => undefined)
  }
  active.abort.addEventListener("abort", onAbort, { once: true })

  try {
    const reply = await active.permission.ask({
      id: requestID,
      sessionID: active.sessionID,
      permission,
      patterns,
      always: permissionAlways(permission, patterns),
      metadata,
      ruleset: active.ruleset,
    })
    return allowPermission(params, reply)
  } catch (error) {
    if (active.abort.aborted) return cancelledPermission()
    if (
      error instanceof PermissionV1.DeniedError ||
      error instanceof PermissionV1.RejectedError ||
      error instanceof PermissionV1.CorrectedError
    ) {
      return rejectPermission(params)
    }
    return cancelledPermission()
  } finally {
    active.abort.removeEventListener("abort", onAbort)
  }
}

function permissionName(params: RequestPermissionRequest) {
  return claudeACPToolName(params.toolCall)
}

function permissionMetadata(params: RequestPermissionRequest): Record<string, unknown> {
  const metadata = { ...recordValue(params.toolCall.rawInput) }
  metadata.toolCallId = params.toolCall.toolCallId
  metadata.toolName = claudeACPToolName(params.toolCall)
  metadata.kind = params.toolCall.kind ?? "other"
  metadata.title = params.toolCall.title ?? params.toolCall.toolCallId

  const location = params.toolCall.locations?.find((item) => item.path)?.path
  if (location) {
    metadata.path ??= location
    metadata.filePath ??= location
    metadata.filepath ??= location
  }

  const diff = params.toolCall.content?.find((item) => item.type === "diff")
  if (diff) {
    const diffPath = stringValue(diff.path)
    if (diffPath) {
      metadata.filepath = diffPath
      metadata.filePath = diffPath
    }
    if (diffPath && typeof diff.newText === "string") {
      metadata.diff = createTwoFilesPatch(
        diffPath,
        diffPath,
        typeof diff.oldText === "string" ? diff.oldText : "",
        diff.newText,
      )
    }
  }

  if (params.toolCall.kind === "execute") metadata.command ??= params.toolCall.title ?? params.toolCall.toolCallId
  if (params.toolCall.kind === "fetch") metadata.url ??= params.toolCall.title
  if (params.toolCall.kind === "search") metadata.pattern ??= params.toolCall.title
  return metadata
}

function permissionPatterns(
  permission: string,
  metadata: Record<string, unknown>,
  params: RequestPermissionRequest,
) {
  const locations = params.toolCall.locations?.map((item) => item.path).filter((item): item is string => !!item) ?? []
  if (permission === "bash") return [stringValue(metadata.command) ?? params.toolCall.title ?? params.toolCall.toolCallId]
  if (permission === "webfetch") return [stringValue(metadata.url) ?? params.toolCall.title ?? "*"]
  if (permission === "grep") return [stringValue(metadata.pattern) ?? params.toolCall.title ?? "*"]

  const file = firstString(metadata.filePath, metadata.filepath, metadata.path)
  if ((permission === "read" || permission === "edit") && file) return [file]
  if (locations.length > 0) return locations
  return [stringValue(metadata.toolName) ?? params.toolCall.title ?? "*"]
}

function permissionAlways(permission: string, patterns: string[]) {
  if (permission === "bash") return patterns
  return ["*"]
}

function allowPermission(params: RequestPermissionRequest, reply: PermissionV1.Reply): RequestPermissionResponse {
  void reply
  const option = params.options.find((item) => item.kind === "allow_once")
  if (!option) return cancelledPermission()
  return { outcome: { outcome: "selected", optionId: option.optionId } }
}

function rejectPermission(params: RequestPermissionRequest): RequestPermissionResponse {
  const option = params.options.find((item) => item.kind === "reject_once" || item.kind === "reject_always")
  if (!option) return cancelledPermission()
  return { outcome: { outcome: "selected", optionId: option.optionId } }
}

function cancelledPermission(): RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } }
}

async function createElicitation(
  connection: Connection,
  params: CreateElicitationRequest,
): Promise<CreateElicitationResponse> {
  const active = connection.active
  if (!active || active.abort.aborted) return { action: "cancel" }
  if (params.mode !== "form" || !("sessionId" in params)) return { action: "decline" }

  const fields = claudeACPElicitationFields(params)
  if (fields.length === 0) return { action: "accept", content: {} }

  try {
    const answers = await active.question.ask({
      sessionID: active.sessionID,
      questions: fields.map((field) => field.question),
    })
    return { action: "accept", content: claudeACPElicitationContent(fields, answers) }
  } catch {
    if (active.abort.aborted) return { action: "cancel" }
    return { action: "decline" }
  }
}

export function claudeACPElicitationFields(params: CreateElicitationRequest): ElicitationField[] {
  if (params.mode !== "form") return []
  return Object.entries(params.requestedSchema.properties ?? {}).map(([key, property]) =>
    elicitationField(key, property, params),
  )
}

export function claudeACPElicitationContent(
  fields: ReadonlyArray<ElicitationField>,
  answers: ReadonlyArray<Question.Answer>,
) {
  return Object.fromEntries(
    fields.flatMap((field, index) => {
      const value = field.value(answers[index] ?? [])
      if (value === undefined) return []
      return [[field.key, value]]
    }),
  )
}

function elicitationField(key: string, property: ElicitationPropertySchema, params: CreateElicitationRequest) {
  const title = property.title ?? key
  const description = property.description ?? params.message
  const base = {
    header: shortHeader(title),
    question: title,
  }

  if (property.type === "string") {
    const choices = property.oneOf?.map((item) => ({ label: item.title, description: item.const })) ?? property.enum
    const options = choices?.map((item) =>
      typeof item === "string" ? { label: item, description } : { label: item.label, description: item.description },
    )
    const values = choices?.map(
      (item): readonly [string, string] =>
        typeof item === "string" ? [item, item] : [item.label, item.description],
    )
    return {
      key,
      question: { ...base, options: options ?? [], custom: !options?.length },
      value: (answers: ReadonlyArray<string>) => valueFromLabels(values, answers, property.default),
    } satisfies ElicitationField
  }

  if (property.type === "array") {
    const raw = "anyOf" in property.items ? property.items.anyOf : property.items.enum
    const values = raw.map(
      (item): readonly [string, string] => (typeof item === "string" ? [item, item] : [item.title, item.const]),
    )
    return {
      key,
      question: {
        ...base,
        options: values.map(([label, value]) => ({ label, description: value })),
        custom: false,
        multiple: true,
      },
      value: (answers: ReadonlyArray<string>) => valueFromLabels(values, answers, property.default ?? []),
    } satisfies ElicitationField
  }

  if (property.type === "boolean") {
    return {
      key,
      question: {
        ...base,
        options: [
          { label: "Yes", description },
          { label: "No", description },
        ],
        custom: false,
      },
      value: (answers: ReadonlyArray<string>) => {
        if (answers[0] === "Yes") return true
        if (answers[0] === "No") return false
        return property.default ?? undefined
      },
    } satisfies ElicitationField
  }

  return {
    key,
    question: { ...base, options: [], custom: true },
    value: (answers: ReadonlyArray<string>) => {
      const value = answers[0]
      if (value === undefined || value.trim() === "") return property.default ?? undefined
      const parsed = property.type === "integer" ? Number.parseInt(value, 10) : Number(value)
      if (Number.isNaN(parsed)) return property.default ?? undefined
      return parsed
    },
  } satisfies ElicitationField
}

function valueFromLabels(
  values: ReadonlyArray<readonly [string, string]> | undefined,
  answers: ReadonlyArray<string>,
  fallback: string | ReadonlyArray<string> | null | undefined,
) {
  if (!values) return answers[0] ?? fallback ?? undefined
  const selected = answers.flatMap((answer) => values.find(([label]) => label === answer)?.[1] ?? [])
  if (Array.isArray(fallback)) return selected.length ? selected : fallback
  return selected[0] ?? fallback ?? undefined
}

function shortHeader(value: string) {
  return value.length <= 30 ? value : value.slice(0, 30)
}

export function claudeACPDirectPermissionChecks(input: DirectPermissionInput): DirectPermissionCheck[] {
  if (input.kind === "terminal") {
    const cwd = input.terminalCwd ? resolveACPPath(input.cwd, input.terminalCwd) : path.resolve(input.cwd)
    const command = [input.command, ...(input.args ?? [])].join(" ")
    return uniqueDirectPermissionChecks([
      ...externalDirectoryPermission(input.cwd, cwd, "directory"),
      ...terminalArgumentExternalPermissions(input.cwd, cwd, input.args),
      {
        permission: "bash",
        patterns: [command],
        always: [`${input.command} *`],
        metadata: {
          command,
          cwd,
        },
      },
    ])
  }

  const target = resolveACPPath(input.cwd, input.path)
  return [
    ...externalDirectoryPermission(input.cwd, target, "file"),
    {
      permission: input.kind === "read" ? "read" : "edit",
      patterns: [permissionPathPattern(input.cwd, target)],
      always: ["*"],
      metadata: {
        filepath: target,
      },
    },
  ]
}

function uniqueDirectPermissionChecks(checks: DirectPermissionCheck[]) {
  const seen = new Set<string>()
  return checks.filter((check) => {
    const key = `${check.permission}\0${check.patterns.join("\0")}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function terminalArgumentExternalPermissions(
  projectCwd: string,
  terminalCwd: string,
  args: readonly string[] | null | undefined,
) {
  return (args ?? []).flatMap((arg) => {
    const target = terminalArgumentPath(terminalCwd, arg)
    return target ? externalDirectoryPermission(projectCwd, target, "file") : []
  })
}

function terminalArgumentPath(cwd: string, value: string) {
  const candidate = terminalArgumentPathCandidate(value)
  if (!candidate) return
  return resolveACPPath(cwd, candidate)
}

function terminalArgumentPathCandidate(value: string) {
  const text = unquote(value.trim())
  if (!text || text === "." || /^\/[A-Za-z]$/i.test(text)) return
  const assigned = text.includes("=") ? text.slice(text.indexOf("=") + 1) : text
  const candidate = unquote(assigned)
  if (
    path.isAbsolute(candidate) ||
    candidate.startsWith("../") ||
    candidate.startsWith("..\\") ||
    candidate.startsWith("./") ||
    candidate.startsWith(".\\") ||
    candidate.includes("/") ||
    candidate.includes("\\")
  ) {
    return candidate
  }
}

function unquote(value: string) {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === `"` || first === "'") && first === last) return value.slice(1, -1)
  return value
}

async function assertACPDirectPermissions(
  active: ActivePermissionRequest | undefined,
  checks: ReadonlyArray<DirectPermissionCheck>,
) {
  if (!active || active.abort.aborted) throw RequestError.invalidParams({}, "permission unavailable")

  for (const check of checks) {
    const requestID = PermissionV1.ID.ascending()
    const onAbort = () => {
      void active.permission.reply({ requestID, reply: "reject" }).catch(() => undefined)
    }
    active.abort.addEventListener("abort", onAbort, { once: true })
    try {
      await active.permission.ask({
        id: requestID,
        sessionID: active.sessionID,
        ...check,
        ruleset: active.ruleset,
      })
    } catch (error) {
      if (active.abort.aborted) throw RequestError.invalidParams({}, "permission cancelled")
      if (
        error instanceof PermissionV1.DeniedError ||
        error instanceof PermissionV1.RejectedError ||
        error instanceof PermissionV1.CorrectedError
      ) {
        throw RequestError.invalidParams(
          { permission: check.permission, patterns: check.patterns },
          "permission denied",
        )
      }
      throw RequestError.internalError({ permission: check.permission }, errorMessage(error))
    } finally {
      active.abort.removeEventListener("abort", onAbort)
    }
  }
}

function externalDirectoryPermission(cwd: string, target: string, kind: "file" | "directory"): DirectPermissionCheck[] {
  if (containsACPPath(cwd, target)) return []
  const dir = kind === "directory" ? target : path.dirname(target)
  const pattern = path.join(dir, "*")
  return [
    {
      permission: "external_directory",
      patterns: [pattern],
      always: [pattern],
      metadata: {
        filepath: target,
        parentDir: dir,
      },
    },
  ]
}

function permissionPathPattern(cwd: string, target: string) {
  if (!containsACPPath(cwd, target)) return target
  return path.relative(path.resolve(cwd), target) || "."
}

function containsACPPath(cwd: string, target: string) {
  const relative = path.relative(path.resolve(cwd), target)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function readTextFile(
  active: ActiveDirectRequest | undefined,
  cwd: string,
  params: ReadTextFileRequest,
): Promise<ReadTextFileResponse> {
  const base = active?.cwd ?? cwd
  const target = resolveACPPath(base, params.path)
  await assertACPDirectPermissions(
    active,
    claudeACPDirectPermissionChecks({ kind: "read", cwd: base, path: params.path }),
  )
  const content = await Bun.file(target).text()
  if (!params.line && !params.limit) return { content }
  const start = (params.line ?? 1) - 1
  return { content: content.split(/\r?\n/).slice(start, params.limit ? start + params.limit : undefined).join("\n") }
}

async function writeTextFile(
  active: ActiveDirectRequest | undefined,
  cwd: string,
  params: WriteTextFileRequest,
): Promise<WriteTextFileResponse> {
  const base = active?.cwd ?? cwd
  const target = resolveACPPath(base, params.path)
  await assertACPDirectPermissions(
    active,
    claudeACPDirectPermissionChecks({ kind: "write", cwd: base, path: params.path }),
  )
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, params.content)
  return {}
}

async function createTerminal(
  input: Connection,
  params: CreateTerminalRequest,
): Promise<CreateTerminalResponse> {
  const terminalId = `claude-acp-terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const output: string[] = []
  const base = input.active?.cwd ?? input.cwd
  const cwd = params.cwd ? resolveACPPath(base, params.cwd) : base
  await assertACPDirectPermissions(
    input.active,
    claudeACPDirectPermissionChecks({
      kind: "terminal",
      cwd: base,
      command: params.command,
      args: params.args,
      terminalCwd: params.cwd,
    }),
  )
  const subprocess = Bun.spawn({
    cmd: [params.command, ...(params.args ?? [])],
    cwd,
    env: params.env ? { ...process.env, ...Object.fromEntries(params.env.map((entry) => [entry.name, entry.value])) } : process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const terminal: Terminal = {
    process: subprocess,
    output,
    limit: claudeACPTerminalOutputLimit(params.outputByteLimit),
    truncated: false,
    exited: subprocess.exited.then((exitCode) => {
      terminal.exitStatus = { exitCode }
      return terminal.exitStatus
    }),
  }
  input.terminals.set(terminalId, terminal)
  void collect(subprocess.stdout, output, terminal.limit, () => {
    terminal.truncated = true
  })
  void collect(subprocess.stderr, output, terminal.limit, () => {
    terminal.truncated = true
  })
  return { terminalId }
}

async function terminalOutput(
  terminals: Map<string, Terminal>,
  params: TerminalOutputRequest,
): Promise<TerminalOutputResponse> {
  const terminal = requireTerminal(terminals, params.terminalId)
  return { output: terminal.output.join(""), truncated: terminal.truncated, exitStatus: terminal.exitStatus }
}

async function waitForTerminalExit(
  terminals: Map<string, Terminal>,
  params: WaitForTerminalExitRequest,
): Promise<WaitForTerminalExitResponse> {
  return requireTerminal(terminals, params.terminalId).exited
}

async function killTerminal(terminals: Map<string, Terminal>, params: KillTerminalRequest): Promise<KillTerminalResponse> {
  requireTerminal(terminals, params.terminalId).process.kill()
  return {}
}

async function releaseTerminal(
  terminals: Map<string, Terminal>,
  params: ReleaseTerminalRequest,
): Promise<ReleaseTerminalResponse> {
  const terminal = requireTerminal(terminals, params.terminalId)
  terminal.process.kill()
  terminals.delete(params.terminalId)
  return {}
}

function requireTerminal(terminals: Map<string, Terminal>, terminalID: string) {
  const terminal = terminals.get(terminalID)
  if (!terminal) throw RequestError.resourceNotFound(terminalID)
  return terminal
}

export function claudeACPTerminalOutputLimit(value: number | null | undefined) {
  if (typeof value !== "number") return TERMINAL_OUTPUT_DEFAULT
  if (!Number.isFinite(value)) return TERMINAL_OUTPUT_DEFAULT
  return Math.min(TERMINAL_OUTPUT_MAX, Math.max(0, Math.floor(value)))
}

export function claudeACPAppendOutput(output: string[], text: string, limit: number) {
  if (!text) return false
  output.push(text)
  const trimmed = trimOutput(output.join(""), claudeACPTerminalOutputLimit(limit))
  if (!trimmed.truncated) return false
  output.length = 0
  if (trimmed.text) output.push(trimmed.text)
  return true
}

function trimOutput(text: string, limit: number) {
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length <= limit) return { text, truncated: false }
  if (limit <= 0) return { text: "", truncated: true }

  let start = bytes.length - limit
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
  return { text: bytes.subarray(start).toString("utf8"), truncated: true }
}

async function collect(stream: ReadableStream<Uint8Array>, output: string[], limit: number, onTruncated?: () => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const read = await reader.read().catch(() => undefined)
    if (!read) return
    if (read.done) {
      appendCollectedOutput(decoder.decode())
      return
    }
    appendCollectedOutput(decoder.decode(read.value, { stream: true }))
  }

  function appendCollectedOutput(text: string) {
    if (!text) return
    if (claudeACPAppendOutput(output, text, limit)) onTruncated?.()
  }
}

function finish(
  queue: ReturnType<typeof makeQueue>,
  reason: FinishReason,
  usage?: Usage,
  providerMetadata?: ACPProviderMetadata,
) {
  queue.closeBlocks()
  queue.push(LLMEvent.stepFinish({ index: 0, reason, usage, providerMetadata }))
  queue.push(LLMEvent.finish({ reason, usage, providerMetadata }))
  queue.end()
}

function finishReason(reason: string): FinishReason {
  if (reason === "end_turn") return "stop"
  if (reason === "max_tokens") return "length"
  if (reason === "cancelled") return "error"
  if (reason === "refusal") return "content-filter"
  return "unknown"
}

export function claudeUsage(input: ACPUsage | null | undefined, context?: ACPContextUsage) {
  if (!input) return
  const nonCachedInputTokens = token(input.inputTokens)
  const cacheReadInputTokens = token(input.cachedReadTokens)
  const cacheWriteInputTokens = token(input.cachedWriteTokens)
  const inputTokens = (nonCachedInputTokens ?? 0) + (cacheReadInputTokens ?? 0) + (cacheWriteInputTokens ?? 0)
  return new Usage({
    inputTokens,
    outputTokens: token(input.outputTokens),
    nonCachedInputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens,
    reasoningTokens: token(input.thoughtTokens),
    totalTokens: context?.used ?? token(input.totalTokens),
    providerMetadata: { anthropic: context ? { ...input, context } : input },
  })
}

export function claudeContextUsage(context: ACPContextUsage | undefined) {
  if (!context) return
  return new Usage({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: context.used,
    providerMetadata: { anthropic: { context } },
  })
}

export function claudeACPCompactionStatus(text: string) {
  const normalized = text.trim()
  if (normalized === "Compacting...") return "started"
  if (normalized === "Compacting completed.") return "completed"
  return undefined
}

function claudeProviderMetadata(providerCompacted: boolean | undefined): ACPProviderMetadata | undefined {
  if (!providerCompacted) return
  return { anthropic: { acpCompacted: true } }
}

function token(value: number | null | undefined) {
  if (typeof value !== "number") return
  if (!Number.isFinite(value)) return
  return Math.max(0, value)
}

function promptText(messages: ModelMessage[]) {
  const last = messages.at(-1)
  if (last?.role === "user") {
    const text = contentText(last.content).trim()
    if (text.match(/^\/[A-Za-z][\w:-]*(?:\s|$)/)) return text
  }

  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${contentText(message.content)}`)
    .filter((message) => message.trim() !== "")
    .join("\n\n")
}

function currentPromptText(messages: ModelMessage[]) {
  const last = messages.at(-1)
  if (last?.role !== "user") return promptText(messages)
  const text = contentText(last.content).trim()
  return text || promptText(messages)
}

function claudeModelID(modelID: string) {
  if (modelID === "claude" || modelID === "default") return
  if (modelID === "fable") return "claude-fable-5"
  if (modelID === "fable[1m]") return "claude-fable-5[1m]"
  return modelID
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.entries(value)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string")
}

function contentText(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return JSON.stringify(content)
  return content
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "file") return `[file: ${part.filename ?? part.mediaType}]`
      if (part.type === "image") return "[image]"
      return JSON.stringify(part)
    })
    .join("\n")
}

export function resolveACPPath(cwd: string, value: string) {
  if (path.isAbsolute(value)) return path.resolve(value)
  return path.resolve(cwd, value)
}

function writable(sink: Bun.FileSink): WritableStream<Uint8Array> {
  return new WritableStream({
    write: (chunk) => {
      sink.write(chunk)
      sink.flush()
    },
    close: () => {
      sink.end()
    },
  })
}

function makeQueue() {
  const items: QueueItem[] = []
  const waiting: ((item: QueueItem) => void)[] = []
  let textStarted = false
  let reasoningStarted = false
  return {
    push(event: LLMEventType) {
      offer({ type: "event", event })
    },
    text(text: string) {
      if (!textStarted) {
        textStarted = true
        offer({ type: "event", event: LLMEvent.textStart({ id: TEXT_ID }) })
      }
      offer({ type: "event", event: LLMEvent.textDelta({ id: TEXT_ID, text }) })
    },
    reasoning(text: string) {
      if (!reasoningStarted) {
        reasoningStarted = true
        offer({ type: "event", event: LLMEvent.reasoningStart({ id: REASONING_ID }) })
      }
      offer({ type: "event", event: LLMEvent.reasoningDelta({ id: REASONING_ID, text }) })
    },
    closeBlocks() {
      if (reasoningStarted) {
        reasoningStarted = false
        offer({ type: "event", event: LLMEvent.reasoningEnd({ id: REASONING_ID }) })
      }
      if (textStarted) {
        textStarted = false
        offer({ type: "event", event: LLMEvent.textEnd({ id: TEXT_ID }) })
      }
    },
    end() {
      offer({ type: "done" })
    },
    fail(error: unknown) {
      offer({ type: "error", error })
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = items.shift() ?? (await new Promise<QueueItem>((resolve) => waiting.push(resolve)))
        if (item.type === "event") {
          yield item.event
          continue
        }
        if (item.type === "error") throw item.error
        return
      }
    },
  }

  function offer(item: QueueItem) {
    const resolve = waiting.shift()
    if (resolve) {
      resolve(item)
      return
    }
    items.push(item)
  }
}

export * as ClaudeACP from "./claude-acp"
