import type { McpServer } from "@agentclientprotocol/sdk"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Hash } from "@opencode-ai/core/util/hash"
import { LLMEvent, ToolResultValue, Usage, type FinishReason, type ProviderMetadata } from "@opencode-ai/llm"
import { Question } from "@/question"
import type { ModelMessage } from "ai"
import { createTwoFilesPatch } from "diff"
import { fromAsyncIterable, type Stream } from "effect/Stream"

type ClaudeAgentConstructor = (typeof import("@agentclientprotocol/claude-agent-acp"))["ClaudeAcpAgent"]
type ClaudeAgent = Pick<
  InstanceType<ClaudeAgentConstructor>,
  "initialize" | "newSession" | "resumeSession" | "prompt" | "cancel" | "setSessionConfigOption" | "dispose"
>
type ACPClient = ConstructorParameters<ClaudeAgentConstructor>[0]
type AgentFactory = (client: ACPClient) => Promise<ClaudeAgent>
type SessionNotification = Parameters<ACPClient["sessionUpdate"]>[0]
type RequestPermissionRequest = Parameters<ACPClient["requestPermission"]>[0]
type RequestPermissionResponse = Awaited<ReturnType<ACPClient["requestPermission"]>>
type CreateElicitationRequest = Parameters<ACPClient["unstable_createElicitation"]>[0]
type CreateElicitationResponse = Awaited<ReturnType<ACPClient["unstable_createElicitation"]>>
type FormElicitation = Extract<CreateElicitationRequest, { mode: "form" }> & { readonly sessionId: string }
type ElicitationPropertySchema = NonNullable<FormElicitation["requestedSchema"]["properties"]>[string]
type ElicitationContentValue = NonNullable<Extract<CreateElicitationResponse, { action: "accept" }>["content"]>[string]
type SessionConfigOption = NonNullable<Awaited<ReturnType<ClaudeAgent["newSession"]>>["configOptions"]>[number]
type ToolUpdate = Extract<SessionNotification["update"], { sessionUpdate: "tool_call" | "tool_call_update" }>

type QuestionBridge = {
  readonly ask: (
    input: Parameters<Question.Interface["ask"]>[0],
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<Question.Answer>>
}

type AuthorizationBridge = (
  input: {
    readonly id?: PermissionV1.ID
    readonly permission: string
    readonly metadata: Record<string, unknown>
  },
  signal?: AbortSignal,
) => Promise<void>

type Transcript = {
  readonly count: number
  readonly hash: string
  readonly head?: string
}

export type ClaudeACPState = {
  readonly owner: string
  readonly fingerprint: string
  readonly modelID?: string
  readonly sessionID?: string
  readonly transcript?: Transcript
  readonly config?: Record<string, string>
}

export function parseState(value: unknown): ClaudeACPState | undefined {
  const state = recordValue(value)
  if (typeof state.owner !== "string" || typeof state.fingerprint !== "string") return
  if (state.modelID !== undefined && typeof state.modelID !== "string") return
  if (state.sessionID !== undefined && typeof state.sessionID !== "string") return
  if (state.config !== undefined && !stringRecord(state.config)) return
  if (state.transcript !== undefined) {
    const transcript = recordValue(state.transcript)
    if (!Number.isSafeInteger(transcript.count) || Number(transcript.count) < 0 || typeof transcript.hash !== "string")
      return
    if (transcript.head !== undefined && typeof transcript.head !== "string") return
  }
  return state as ClaudeACPState
}

type StreamInput = {
  readonly cwd: string
  readonly sessionID: PermissionV1.AskInput["sessionID"]
  readonly modelID: string
  readonly agent: string
  readonly assistantID: string
  readonly historyID?: string
  readonly resume: boolean
  readonly mcpServers: readonly McpServer[]
  readonly messages: ModelMessage[]
  readonly abort: AbortSignal
  readonly question: QuestionBridge
  readonly authorize: AuthorizationBridge
  readonly state?: ClaudeACPState
}

type ACPToolState = {
  name: string
  title: string
  input: unknown
  content?: ToolUpdate["content"]
  rawOutput?: unknown
  status?: ToolUpdate["status"]
  started: boolean
}

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

type ElicitationField = {
  readonly key: string
  readonly question: Question.Info
  readonly value: (answers: ReadonlyArray<string>) => ElicitationContentValue | undefined
}

type ActiveRequest = {
  readonly queue: ReturnType<typeof makeQueue>
  readonly sessionID: PermissionV1.AskInput["sessionID"]
  readonly abort: AbortSignal
  readonly question: QuestionBridge
  readonly authorize: AuthorizationBridge
  readonly tools: Map<string, ACPToolState>
  contextUsage?: ACPContextUsage
  compacted?: boolean
}

type ActivePermissionRequest = Pick<ActiveRequest, "abort" | "authorize" | "tools">

type Connection = {
  readonly agent: ClaudeAgent
  readonly controller: AbortController
  readonly fingerprint: string
  sessionID: string
  configOptions: SessionConfigOption[]
  used: boolean
  idles: ReturnType<typeof Promise.withResolvers<void>>[]
  disposal?: Promise<void>
  disposeTimer?: ReturnType<typeof setTimeout>
  active?: ActiveRequest
}

type QueueItem =
  | { readonly type: "event"; readonly event: LLMEvent }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly error: unknown }

const TEXT_ID = "claude-acp-text"
const REASONING_ID = "claude-acp-reasoning"
const DRAIN_TIMEOUT = 10 * 60 * 1_000
const drainingConnections = new Map<
  PermissionV1.AskInput["sessionID"],
  {
    readonly connection: Connection
    readonly idle: ReturnType<typeof Promise.withResolvers<void>>
    readonly expired: ReturnType<typeof Promise.withResolvers<void>>
    closing?: Promise<void>
  }
>()
const liveConnections = new Set<Connection>()

process.once("exit", () => liveConnections.forEach((connection) => void disposeConnection(connection, true)))

export function stream(input: StreamInput, agentFactory?: AgentFactory): Stream<LLMEvent, unknown> {
  return fromAsyncIterable(run(input, agentFactory), (error) =>
    error instanceof Error ? error : new Error(String(error)),
  )
}

async function* run(input: StreamInput, agentFactory?: AgentFactory) {
  const queue = makeQueue()
  let connection: Connection | undefined
  let ownsConnection = false
  let finished = false
  let compacted = false
  let contextUsage: ACPContextUsage | undefined
  let closed = false
  const onAbort = () => {
    if (!connection || !ownsConnection) return
    connection.controller.abort()
    void connection.agent.cancel({ sessionId: connection.sessionID }).catch(() => undefined)
  }
  input.abort.addEventListener("abort", onAbort, { once: true })

  void (async () => {
    try {
      queue.push(LLMEvent.stepStart({ index: 0 }))
      assertTextHistory(input.messages)
      connection = await connectionFor(input, connectionFingerprint(input), agentFactory)
      ownsConnection = true
      if (closed || input.abort.aborted) throw abortError()
      connection.active = {
        queue,
        sessionID: input.sessionID,
        abort: input.abort,
        question: input.question,
        authorize: input.authorize,
        tools: new Map(),
      }
      let committed: Transcript | undefined
      let prompted = false
      let safe = false
      let idle: ReturnType<typeof Promise.withResolvers<void>> | undefined
      try {
        const text = currentPromptText(input.messages)
        const command = claudeACPConfigCommand(text)
        if (command) {
          const message = await applyConfigCommand(connection, command)
          if (input.abort.aborted) throw abortError()
          queue.text(message)
          safe = true
          committed = connection.used ? { ...transcript(input.messages), head: input.assistantID } : undefined
          const metadata = stateMetadata(input, connection, committed)
          return finish(queue, "stop", undefined, metadata)
        }
        const slash = /^\/[A-Za-z][\w:-]*(?:\s|$)/.test(text)
        if (!connection.used && slash && input.messages.slice(0, -1).some((message) => message.role !== "system")) {
          throw new Error(`Run a normal prompt to resync Claude before using ${text.split(/\s/, 1)[0]}.`)
        }
        prompted = true
        idle = Promise.withResolvers<void>()
        connection.idles.push(idle)
        const response = await connection.agent.prompt({
          sessionId: connection.sessionID,
          prompt: [{ type: "text", text: connection.used || slash ? text : promptText(input.messages) }],
        })
        connection.used = true
        const aborted = input.abort.aborted || response.stopReason === "cancelled"
        safe = !aborted
        compacted = connection.active?.compacted === true
        committed = safe ? { ...transcript(input.messages), head: input.assistantID } : undefined
        return finish(
          queue,
          aborted ? "error" : finishReason(response.stopReason),
          claudeUsage(response.usage, connection.active?.contextUsage) ??
            claudeContextUsage(connection.active?.contextUsage),
          compacted
            ? stateMetadata(input, connection, undefined, true)
            : safe
              ? stateMetadata(input, connection, committed)
              : stateMetadata(input, connection),
        )
      } finally {
        compacted ||= connection.active?.compacted === true
        contextUsage = connection.active?.contextUsage
        ownsConnection = false
        connection.active = undefined
        const reusable = safe && !compacted && prompted && input.resume && input.agent !== "compaction"
        if (reusable) drainConnection(input.sessionID, connection, idle!)
        if (!reusable) await disposeConnection(connection, !safe)
      }
    } catch (error) {
      const usage = claudeContextUsage(connection?.active?.contextUsage ?? contextUsage)
      if (connection && ownsConnection) {
        ownsConnection = false
        connection.active = undefined
        await disposeConnection(connection, true)
      }
      if (connection && compacted)
        return finish(queue, "error", usage, stateMetadata(input, connection, undefined, true))
      if (input.abort.aborted)
        return finish(queue, "error", usage, connection ? stateMetadata(input, connection) : clearStateMetadata(input))
      queue.fail(claudeError(error))
    }
  })()

  try {
    for await (const event of queue) {
      finished = event.type === "finish"
      yield event
    }
  } finally {
    closed = true
    input.abort.removeEventListener("abort", onAbort)
    if (connection && ownsConnection && !finished) {
      await connection.agent.cancel({ sessionId: connection.sessionID }).catch(() => undefined)
      await disposeConnection(connection, true)
    }
  }
}

async function createConnection(input: StreamInput, fingerprint: string, agentFactory?: AgentFactory) {
  if (input.abort.aborted) throw abortError()
  let connection: Connection | undefined
  const controller = new AbortController()
  const onAbort = () => {
    controller.abort()
    if (connection?.sessionID) void connection.agent.cancel({ sessionId: connection.sessionID }).catch(() => undefined)
  }
  input.abort.addEventListener("abort", onAbort, { once: true })
  const client = makeClient(() => connection!)
  try {
    const agent = agentFactory ? await agentFactory(client) : await createAgent(client)
    connection = {
      agent,
      controller,
      fingerprint,
      sessionID: "",
      configOptions: [],
      used: false,
      idles: [],
    }
    liveConnections.add(connection)
    await agent.initialize({
      protocolVersion: 1,
      clientInfo: { name: "OpenCode", version: "0.0.0" },
      clientCapabilities: {
        elicitation: { form: {} },
        session: { configOptions: { boolean: {} } },
      },
    })
    if (input.abort.aborted) throw abortError()
    const params = {
      cwd: input.cwd,
      mcpServers: [...input.mcpServers],
      _meta: {
        systemPrompt: {
          type: "preset" as const,
          preset: "claude_code" as const,
        },
        claudeCode: {
          emitRawSDKMessages: [{ type: "system", subtype: "session_state_changed" }],
          options: {
            abortController: controller,
            allowedTools: [],
            settings: {
              permissions: {
                allow: [],
                ask: ["*"],
                deny: [],
                defaultMode: "default" as const,
                disableBypassPermissionsMode: "disable" as const,
              },
            },
          },
        },
      },
    }
    const resume =
      input.resume &&
      input.state?.owner === input.sessionID &&
      input.state.fingerprint === connection.fingerprint &&
      continues(input.state.transcript, input.messages, input.historyID)
    const loaded =
      resume && input.state?.sessionID
        ? await agent.resumeSession({ ...params, sessionId: input.state.sessionID }).catch((error) => {
            if (!isMissingSession(error)) throw error
            return undefined
          })
        : undefined
    const created = loaded ? undefined : await agent.newSession(params)
    if (input.abort.aborted) throw abortError()
    connection.sessionID = loaded ? input.state!.sessionID! : created!.sessionId
    connection.used = !!loaded
    connection.configOptions = (loaded ?? created)!.configOptions ?? []
    await applyInitialConfig(connection, input)
    return connection
  } catch (error) {
    if (connection) await disposeConnection(connection, true)
    throw error
  } finally {
    input.abort.removeEventListener("abort", onAbort)
  }
}

async function createAgent(client: ACPClient) {
  if (!process.env.CLAUDE_CODE_EXECUTABLE) {
    // @ts-expect-error - generated file embedded by the standalone build
    const generated = await import("claude-code.gen.ts").catch(() => undefined)
    if (generated) {
      const { extractFromBunfs } = await import("@anthropic-ai/claude-agent-sdk/extract")
      process.env.CLAUDE_CODE_EXECUTABLE = extractFromBunfs(generated.default)
    }
  }
  const { ClaudeAcpAgent } = await import("@agentclientprotocol/claude-agent-acp")
  return new ClaudeAcpAgent(client, { log: () => {}, error: () => {} })
}

function connectionFingerprint(input: StreamInput) {
  const servers = input.mcpServers
    .map((server) =>
      "type" in server
        ? [
            server.name,
            server.type,
            server.url,
            server.headers?.map((item) => [item.name, item.value]).toSorted(([a], [b]) => a.localeCompare(b)),
          ]
        : [
            server.name,
            server.command,
            server.args,
            server.env?.map((item) => [item.name, item.value]).toSorted(([a], [b]) => a.localeCompare(b)),
          ],
    )
    .toSorted(([a], [b]) => String(a).localeCompare(String(b)))
  return Hash.sha256(JSON.stringify([input.cwd, input.modelID, input.agent, servers]))
}

function continues(previous: Transcript | undefined, messages: ModelMessage[], historyID: string | undefined) {
  if (!previous || messages.length <= previous.count) return false
  if (previous.head && previous.head !== historyID) return false
  return transcript(messages, previous.count).hash === previous.hash
}

function transcript(messages: ModelMessage[], count = messages.length): Transcript {
  return {
    count,
    hash: Hash.sha256(JSON.stringify(messages.slice(0, count))),
  }
}

async function connectionFor(input: StreamInput, fingerprint: string, agentFactory?: AgentFactory) {
  const draining = input.resume ? drainingConnections.get(input.sessionID) : undefined
  if (!draining) return createConnection(input, fingerprint, agentFactory)
  const compatible =
    input.state?.sessionID === draining.connection.sessionID &&
    input.state.owner === input.sessionID &&
    input.state.fingerprint === fingerprint &&
    continues(input.state.transcript, input.messages, input.historyID)
  if (!compatible) {
    if (drainingConnections.get(input.sessionID) === draining) drainingConnections.delete(input.sessionID)
    await disposeConnection(draining.connection, true)
    return createConnection(input, fingerprint, agentFactory)
  }
  await waitForDrain(Promise.race([draining.idle.promise, draining.expired.promise]), input.abort)
  if (drainingConnections.get(input.sessionID) === draining) drainingConnections.delete(input.sessionID)
  if (draining.connection.disposeTimer) clearTimeout(draining.connection.disposeTimer)
  if (draining.closing) {
    await draining.closing
    return createConnection(input, fingerprint, agentFactory)
  }
  return draining.connection
}

async function waitForDrain(drain: Promise<void>, signal: AbortSignal) {
  if (signal.aborted) throw abortError()
  const aborted = Promise.withResolvers<void>()
  const onAbort = () => aborted.resolve()
  signal.addEventListener("abort", onAbort, { once: true })
  await Promise.race([drain, aborted.promise])
  signal.removeEventListener("abort", onAbort)
  if (signal.aborted) throw abortError()
}

async function disposeConnection(connection: Connection, abort = false) {
  if (abort) connection.controller.abort()
  if (connection.disposal) return connection.disposal
  if (connection.disposeTimer) clearTimeout(connection.disposeTimer)
  liveConnections.delete(connection)
  connection.disposal = Promise.resolve()
    .then(() => connection.agent.dispose())
    .catch(() => undefined)
  return connection.disposal
}

function drainConnection(
  key: PermissionV1.AskInput["sessionID"],
  connection: Connection,
  idle: ReturnType<typeof Promise.withResolvers<void>>,
) {
  const draining: NonNullable<ReturnType<typeof drainingConnections.get>> = {
    connection,
    idle,
    expired: Promise.withResolvers<void>(),
  }
  drainingConnections.set(key, draining)
  connection.disposeTimer = setTimeout(() => {
    draining.closing = disposeConnection(connection, true)
    void draining.closing.finally(() => {
      draining.expired.resolve()
      if (drainingConnections.get(key) === draining) drainingConnections.delete(key)
    })
  }, DRAIN_TIMEOUT)
  connection.disposeTimer.unref?.()
}

function isMissingSession(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /resource.*not found|session.*not found|no conversation found/i.test(message)
}

function abortError() {
  return new DOMException("Aborted", "AbortError")
}

function claudeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.trim() !== "Authentication required") return error
  return new Error("Claude Code authentication required. Run `claude auth login` in a normal terminal, then retry.")
}

type ConfigCommand = {
  readonly configId: "effort" | "model" | "fast"
  readonly value?: string
}

/** Claude Code handles these as ACP config options rather than SDK slash commands. */
export function claudeACPConfigCommand(text: string): ConfigCommand | undefined {
  const match = text.trim().match(/^\/(effort|model|fast)(?:\s+(\S+))?\s*$/i)
  if (!match) return
  return {
    configId: match[1].toLowerCase() as ConfigCommand["configId"],
    value: match[2]?.toLowerCase(),
  }
}

export function claudeACPConfigOptionValues(option: SessionConfigOption | undefined) {
  if (!option) return []
  if (option.type === "boolean") return ["on", "off"]
  if (option.type !== "select") return []
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry])).map((entry) => entry.value)
}

export function claudeACPConfigOptionCurrent(option: SessionConfigOption | undefined) {
  if (!option) return
  if (option.type === "boolean") return option.currentValue ? "on" : "off"
  if (typeof option.currentValue === "string") return option.currentValue
}

async function applyConfigCommand(connection: Connection, command: ConfigCommand) {
  if (command.configId === "fast") return applyFastCommand(connection, command.value)
  const option = configOption(connection, command.configId)
  if (!option) return `${configLabel(command.configId)} isn't available for this Claude Code session.`
  const current = claudeACPConfigOptionCurrent(option)
  const allowed = claudeACPConfigOptionValues(option)
  if (!command.value) {
    return `${configLabel(command.configId)} is currently ${current ?? "unset"}. Available: ${allowed.join(", ") || "none"}`
  }
  const value = allowed.includes(command.value) || command.configId === "model" ? command.value : undefined
  if (!value) return `Invalid ${command.configId} value "${command.value}". Available: ${allowed.join(", ") || "none"}`
  if (value === current) return `${configLabel(command.configId)} is already ${value}`
  await setConfigOption(connection, command.configId, value, option)
  return `${configLabel(command.configId)} set to ${claudeACPConfigOptionCurrent(configOption(connection, command.configId)) ?? value}`
}

async function applyFastCommand(connection: Connection, raw?: string) {
  const current = () => claudeACPConfigOptionCurrent(configOption(connection, "fast"))
  const desired = resolveFastDesired(raw, current())
  if (desired === "invalid") return `Invalid fast value "${raw}". Use on, off, or omit a value to toggle.`
  if (!desired) {
    const option = configOption(connection, "fast")
    if (option && current() === "on") await setConfigOption(connection, "fast", "off", option)
    return "Fast mode OFF"
  }
  let option = configOption(connection, "fast")
  if (!option) {
    const model = configOption(connection, "model")
    if (!model) return "Fast mode isn't available for this Claude Code session."
    await setConfigOption(connection, "model", "opus", model)
    option = configOption(connection, "fast")
    if (!option) return "Switched to Opus, but Fast mode isn't available for this account."
  }
  if (current() !== "on") await setConfigOption(connection, "fast", "on", option)
  return "Fast mode ON"
}

export function resolveFastDesired(raw: string | undefined, current: string | undefined) {
  if (!raw || raw === "toggle") return current !== "on"
  if (raw === "on" || raw === "true" || raw === "1") return true
  if (raw === "off" || raw === "false" || raw === "0") return false
  return "invalid"
}

function configOption(connection: Connection, id: string) {
  return connection.configOptions.find((item) => item.id === id)
}

function configLabel(id: ConfigCommand["configId"]) {
  if (id === "effort") return "Effort"
  if (id === "model") return "Model"
  return "Fast mode"
}

async function setConfigOption(connection: Connection, configId: string, value: string, option: SessionConfigOption) {
  const response = await connection.agent.setSessionConfigOption(
    option.type === "boolean"
      ? { sessionId: connection.sessionID, configId, type: "boolean", value: value === "on" }
      : { sessionId: connection.sessionID, configId, value },
  )
  connection.configOptions = response.configOptions ?? connection.configOptions
}

async function applyInitialConfig(connection: Connection, input: StreamInput) {
  const config =
    input.state?.owner === input.sessionID && input.state.modelID === input.modelID
      ? (input.state.config ?? {})
      : input.modelID === "claude"
        ? {}
        : { model: claudeModelID(input.modelID) }
  for (const id of ["model", "effort", "fast"] as const) {
    const option = configOption(connection, id)
    const value = config[id]
    if (option && value && value !== claudeACPConfigOptionCurrent(option))
      await setConfigOption(connection, id, value, option)
  }
  const mode = configOption(connection, "mode")
  const desired = input.agent === "plan" ? "plan" : "default"
  if (mode && desired !== claudeACPConfigOptionCurrent(mode)) await setConfigOption(connection, "mode", desired, mode)
}

function stateMetadata(input: StreamInput, connection: Connection, committed?: Transcript, compacted = false) {
  if (!input.resume) return
  const config = Object.fromEntries(
    ["model", "effort", "fast"].flatMap((id) => {
      const value = claudeACPConfigOptionCurrent(configOption(connection, id))
      return value ? [[id, value]] : []
    }),
  )
  return {
    anthropic: {
      claudeACP: {
        owner: input.sessionID,
        fingerprint: connection.fingerprint,
        modelID: input.modelID,
        ...(connection.used && committed ? { sessionID: connection.sessionID, transcript: committed } : {}),
        config,
      } satisfies ClaudeACPState,
      ...(compacted ? { acpCompacted: true } : {}),
    },
  }
}

function clearStateMetadata(input: StreamInput) {
  if (!input.resume) return
  if (!input.state || input.state.owner !== input.sessionID) return { anthropic: { claudeACP: null } }
  return {
    anthropic: {
      claudeACP: {
        owner: input.state.owner,
        fingerprint: input.state.fingerprint,
        modelID: input.state.modelID,
        config: input.state.config,
      } satisfies ClaudeACPState,
    },
  }
}

function makeClient(getConnection: () => Connection): ACPClient {
  return {
    sessionUpdate: async (params) => sessionUpdate(getConnection(), params),
    requestPermission: (params, signal) => requestPermissionForActive(getConnection().active, params, signal),
    unstable_createElicitation: (params, signal) => createElicitation(getConnection().active, params, signal),
    unstable_completeElicitation: async () => {},
    extNotification: async (method, params) => {
      const connection = getConnection()
      const message = recordValue(params.message)
      if (
        method === "_claude/sdkMessage" &&
        params.sessionId === connection.sessionID &&
        message.type === "system" &&
        message.subtype === "session_state_changed" &&
        message.state === "idle"
      )
        connection.idles.shift()?.resolve()
    },
    readTextFile: async () => {
      throw new Error("Claude ACP filesystem capability is not enabled")
    },
    writeTextFile: async () => {
      throw new Error("Claude ACP filesystem capability is not enabled")
    },
  }
}

async function sessionUpdate(connection: Connection, params: SessionNotification) {
  if (params.update.sessionUpdate === "config_option_update") {
    connection.configOptions = params.update.configOptions
    return
  }
  const active = connection.active
  if (!active) return
  if (params.update.sessionUpdate === "usage_update") {
    const used = token(params.update.used)
    const size = token(params.update.size)
    if (!used || !size) return
    active.contextUsage = { used, size }
    active.queue.push(LLMEvent.usage(claudeContextUsage(active.contextUsage)!))
    return
  }
  if (params.update.sessionUpdate === "agent_message_chunk" && params.update.content.type === "text") {
    const text = params.update.content.text.trim()
    if (text === "Compacting...") return
    if (text === "Compacting completed.") {
      active.compacted = true
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
    events.forEach(active.queue.push)
  }
}

export function claudeACPToolEvents(state: Map<string, ACPToolState>, update: ToolUpdate) {
  const previous = state.get(update.toolCallId)
  const tool = {
    name: claudeACPToolName(update, previous?.name),
    title: update.title ?? previous?.title ?? update.toolCallId,
    input: update.rawInput !== undefined ? update.rawInput : (previous?.input ?? {}),
    content: update.content ?? previous?.content,
    rawOutput: update.rawOutput !== undefined ? update.rawOutput : previous?.rawOutput,
    status: update.status ?? previous?.status,
    started: previous?.started ?? false,
  } satisfies ACPToolState
  state.set(update.toolCallId, tool)
  const events: LLMEvent[] = []
  if (!tool.started) {
    tool.started = true
    events.push(
      LLMEvent.toolCall({
        id: update.toolCallId,
        name: tool.name,
        input: tool.input,
        providerExecuted: true,
        providerMetadata: toolMetadata(tool, update),
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
          output: toolOutput(tool),
          metadata: { acp: { status: tool.status, kind: update.kind, rawOutput: tool.rawOutput } },
        }),
        providerExecuted: true,
        providerMetadata: toolMetadata(tool, update),
      }),
    )
    state.delete(update.toolCallId)
  }
  if (tool.status === "failed") {
    events.push(
      LLMEvent.toolError({
        id: update.toolCallId,
        name: tool.name,
        message: toolOutput(tool),
        error: tool.rawOutput,
        providerMetadata: toolMetadata(tool, update),
      }),
    )
    state.delete(update.toolCallId)
  }
  return events
}

function claudeACPToolName(tool: Pick<ToolUpdate, "kind" | "rawInput" | "title" | "_meta">, fallback?: string) {
  const input = recordValue(tool.rawInput)
  const meta = recordValue(recordValue(tool._meta).claudeCode)
  const raw =
    stringValue(meta.toolName) ?? stringValue(input.tool) ?? stringValue(input.toolName) ?? stringValue(input.name)
  const known = claudeToolName(raw ?? "") ?? claudeToolName(tool.title ?? "")
  const inferred =
    typeof input.subagent_type === "string"
      ? "task"
      : Array.isArray(input.todos)
        ? "todowrite"
        : typeof input.query === "string"
          ? "websearch"
          : typeof input.skill === "string"
            ? "skill"
            : undefined
  const names: Partial<Record<NonNullable<ToolUpdate["kind"]>, string>> = {
    execute: "bash",
    edit: "edit",
    delete: "edit",
    move: "edit",
    fetch: "webfetch",
    search: "grep",
    read: "read",
  }
  return (
    known ??
    inferred ??
    (tool.kind ? names[tool.kind] : undefined) ??
    raw ??
    fallback ??
    tool.kind ??
    tool.title ??
    "claude_tool"
  )
}

function claudeToolName(name: string) {
  return {
    bash: "bash",
    read: "read",
    write: "edit",
    edit: "edit",
    notebookedit: "edit",
    glob: "glob",
    grep: "grep",
    webfetch: "webfetch",
    websearch: "websearch",
    task: "task",
    agent: "task",
    todowrite: "todowrite",
    taskcreate: "todowrite",
    taskupdate: "todowrite",
    tasklist: "todowrite",
    taskget: "todowrite",
    skill: "skill",
    lsp: "lsp",
    enterplanmode: "plan_enter",
    exitplanmode: "plan_exit",
  }[name.toLowerCase()]
}

function toolMetadata(tool: ACPToolState, update: ToolUpdate) {
  return {
    anthropic: {
      acpTool: { id: update.toolCallId, name: tool.name, title: tool.title, status: tool.status, kind: update.kind },
    },
  }
}

function toolOutput(tool: ACPToolState) {
  if (typeof tool.rawOutput === "string") return tool.rawOutput
  if (Array.isArray(tool.rawOutput)) {
    return tool.rawOutput
      .map((item) => stringValue(recordValue(item).text) ?? stringify(item))
      .filter(Boolean)
      .join("\n")
  }
  const output = recordValue(tool.rawOutput).output
  if (typeof output === "string") return output
  if (tool.rawOutput !== undefined) return stringify(tool.rawOutput)
  const content = (tool.content ?? []).map(toolContentText).filter(Boolean).join("\n")
  return content || tool.title
}

function toolContentText(content: NonNullable<ToolUpdate["content"]>[number]) {
  if (content.type === "diff") return `Updated ${content.path}`
  if (content.type === "terminal") return `Terminal ${content.terminalId}`
  if (content.content.type === "text") return content.content.text
  if (content.content.type === "image") return "[image]"
  return stringify(content.content)
}

export async function requestPermissionForActive(
  active: ActivePermissionRequest | undefined,
  params: RequestPermissionRequest,
  signal?: AbortSignal,
): Promise<RequestPermissionResponse> {
  if (!active || active.abort.aborted || signal?.aborted) return cancelledPermission()
  const requestID = PermissionV1.ID.ascending()
  const permission = active.tools.get(params.toolCall.toolCallId)?.name ?? claudeACPToolName(params.toolCall)
  const metadata = permissionMetadata(params, permission)
  try {
    await active.authorize(
      {
        id: requestID,
        permission,
        metadata,
      },
      signal,
    )
    if (active.abort.aborted || signal?.aborted) return cancelledPermission()
    const option = params.options.find((item) => item.kind === "allow_once")
    return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : cancelledPermission()
  } catch (error) {
    if (
      error instanceof PermissionV1.DeniedError ||
      error instanceof PermissionV1.RejectedError ||
      error instanceof PermissionV1.CorrectedError
    ) {
      const option = params.options.find((item) => item.kind === "reject_once" || item.kind === "reject_always")
      return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : cancelledPermission()
    }
    return cancelledPermission()
  }
}

function permissionMetadata(params: RequestPermissionRequest, permission: string): Record<string, unknown> {
  const raw = recordValue(params.toolCall.rawInput)
  const metadata: Record<string, unknown> = {
    ...raw,
    toolCallId: params.toolCall.toolCallId,
    toolName: permission,
    kind: params.toolCall.kind ?? "other",
    title: params.toolCall.title ?? params.toolCall.toolCallId,
  }
  metadata.filepath ??= [raw.file_path, raw.notebook_path, raw.filePath, raw.filepath].find(
    (value): value is string => typeof value === "string",
  )
  const location = params.toolCall.locations?.find((item) => item.path)?.path
  if (location) metadata.filepath ??= location
  metadata.filePath ??= metadata.filepath
  const diff = params.toolCall.content?.find((item) => item.type === "diff")
  if (diff?.path) {
    metadata.filepath = diff.path
    metadata.filePath = diff.path
    if (typeof diff.newText === "string") {
      metadata.diff = createTwoFilesPatch(
        diff.path,
        diff.path,
        typeof diff.oldText === "string" ? diff.oldText : "",
        diff.newText,
      )
    }
  }
  if (params.toolCall.kind === "execute") metadata.command ??= params.toolCall.title ?? params.toolCall.toolCallId
  if (params.toolCall.kind === "fetch") metadata.url ??= params.toolCall.title
  if (params.toolCall.kind === "search") metadata.pattern ??= params.toolCall.title
  if ((metadata.toolName === "glob" || metadata.toolName === "grep") && typeof metadata.path !== "string") {
    metadata.path = stringValue(raw.path)
  }
  return metadata
}

function cancelledPermission(): RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } }
}

async function createElicitation(
  active: ActiveRequest | undefined,
  params: CreateElicitationRequest,
  signal?: AbortSignal,
): Promise<CreateElicitationResponse> {
  if (!active || active.abort.aborted || signal?.aborted) return { action: "cancel" }
  if (!isFormElicitation(params)) return { action: "decline" }
  const fields = claudeACPElicitationFields(params)
  if (fields.length === 0) return { action: "accept", content: {} }
  try {
    await active.authorize(
      {
        permission: "question",
        metadata: {},
      },
      signal,
    )
    if (active.abort.aborted || signal?.aborted) return { action: "cancel" }
    const answers = await active.question.ask(
      { sessionID: active.sessionID, questions: fields.map((field) => field.question) },
      signal,
    )
    return { action: "accept", content: claudeACPElicitationContent(fields, answers) }
  } catch {
    return { action: active.abort.aborted || signal?.aborted ? "cancel" : "decline" }
  }
}

function stringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  )
}

export function claudeACPElicitationFields(params: FormElicitation): ElicitationField[] {
  return Object.entries(params.requestedSchema.properties ?? {}).flatMap(
    ([key, property]) => elicitationField(key, property, params) ?? [],
  )
}

export function claudeACPElicitationContent(
  fields: ReadonlyArray<ElicitationField>,
  answers: ReadonlyArray<Question.Answer>,
) {
  return Object.fromEntries(
    fields.flatMap((field, index) => {
      const value = field.value(answers[index] ?? [])
      return value === undefined ? [] : [[field.key, value]]
    }),
  )
}

function elicitationField(key: string, property: ElicitationPropertySchema, params: FormElicitation) {
  const raw = recordValue(property)
  const title = stringValue(raw.title) ?? key
  const description = stringValue(raw.description) ?? params.message
  const base = { header: title.slice(0, 30), question: title }
  if (isElicitationProperty(property, "string")) {
    const choices =
      property.oneOf?.map((item) => [item.title, item.const] as const) ??
      property.enum?.map((item) => [item, item] as const)
    return {
      key,
      question: {
        ...base,
        options: choices?.map(([label, value]) => ({ label, description: value })) ?? [],
        custom: !choices?.length,
      },
      value: (answers: ReadonlyArray<string>) => valueFromLabels(choices, answers, property.default),
    } satisfies ElicitationField
  }
  if (isElicitationProperty(property, "array")) {
    const items = recordValue(property.items)
    const raw = Array.isArray(items.anyOf) ? items.anyOf : Array.isArray(items.enum) ? items.enum : []
    const choices = raw.flatMap((item) => {
      if (typeof item === "string") return [[item, item] as const]
      const option = recordValue(item)
      const title = stringValue(option.title)
      const value = stringValue(option.const)
      return title && value ? [[title, value] as const] : []
    })
    return {
      key,
      question: {
        ...base,
        options: choices.map(([label, value]) => ({ label, description: value })),
        custom: false,
        multiple: true,
      },
      value: (answers: ReadonlyArray<string>) => valueFromLabels(choices, answers, property.default ?? []),
    } satisfies ElicitationField
  }
  if (isElicitationProperty(property, "boolean")) {
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
      value: (answers: ReadonlyArray<string>) =>
        answers[0] === "Yes" ? true : answers[0] === "No" ? false : (property.default ?? undefined),
    } satisfies ElicitationField
  }
  if (!isElicitationProperty(property, "integer") && !isElicitationProperty(property, "number")) return
  return {
    key,
    question: { ...base, options: [], custom: true },
    value: (answers: ReadonlyArray<string>) => {
      const value = answers[0]
      if (!value?.trim()) return property.default ?? undefined
      const parsed = property.type === "integer" ? Number.parseInt(value, 10) : Number(value)
      return Number.isNaN(parsed) ? (property.default ?? undefined) : parsed
    },
  } satisfies ElicitationField
}

function isFormElicitation(params: CreateElicitationRequest): params is FormElicitation {
  return params.mode === "form" && "sessionId" in params
}

function isElicitationProperty<T extends string>(
  property: ElicitationPropertySchema,
  type: T,
): property is Extract<ElicitationPropertySchema, { type: T }> {
  return property.type === type
}

function valueFromLabels(
  values: ReadonlyArray<readonly [string, string]> | undefined,
  answers: ReadonlyArray<string>,
  fallback: string | ReadonlyArray<string> | null | undefined,
) {
  if (!values) return answers[0] ?? fallback ?? undefined
  const selected = answers.flatMap((answer) => values.find(([label]) => label === answer)?.[1] ?? [])
  return Array.isArray(fallback) ? (selected.length ? selected : fallback) : (selected[0] ?? fallback ?? undefined)
}

function finish(
  queue: ReturnType<typeof makeQueue>,
  reason: FinishReason,
  usage?: Usage,
  providerMetadata?: ProviderMetadata,
) {
  queue.closeBlocks()
  queue.push(LLMEvent.stepFinish({ index: 0, reason, usage, providerMetadata }))
  queue.push(LLMEvent.finish({ reason, usage, providerMetadata }))
  queue.end()
}

function finishReason(reason: string): FinishReason {
  if (reason === "end_turn") return "stop"
  if (reason === "max_tokens" || reason === "max_turn_requests") return "length"
  if (reason === "cancelled") return "error"
  if (reason === "refusal") return "content-filter"
  return "unknown"
}

export function claudeUsage(input: ACPUsage | null | undefined, context?: ACPContextUsage) {
  if (!input) return
  const nonCachedInputTokens = token(input.inputTokens)
  const cacheReadInputTokens = token(input.cachedReadTokens)
  const cacheWriteInputTokens = token(input.cachedWriteTokens)
  return new Usage({
    inputTokens: (nonCachedInputTokens ?? 0) + (cacheReadInputTokens ?? 0) + (cacheWriteInputTokens ?? 0),
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

function token(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined
}

function promptText(messages: ModelMessage[]) {
  return messages
    .map((message) => {
      const text = contentText(message.content)
      return `${message.role.toUpperCase()}:\n${text}`
    })
    .filter((message) => message.trim() !== "")
    .join("\n\n")
}

function currentPromptText(messages: ModelMessage[]) {
  const start = messages.findLastIndex((message) => message.role === "user")
  if (start < 0) return promptText(messages)
  const current = messages.slice(start)
  if (current.length > 1) return promptText(current)
  return contentText(current[0].content).trim() || promptText(messages)
}

function claudeModelID(modelID: string) {
  if (modelID === "fable") return "claude-fable-5"
  if (modelID === "fable[1m]") return "claude-fable-5[1m]"
  return modelID
}

function assertTextHistory(messages: ModelMessage[]) {
  if (
    messages.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (part) =>
            part.type === "file" ||
            part.type === "image" ||
            (part.type === "tool-result" &&
              part.output.type === "content" &&
              part.output.value.some((value) => value.type !== "text")),
        ),
    )
  ) {
    throw new Error("Claude ACP does not support file or image history")
  }
}

function contentText(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return stringify(content)
  return content
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "file") return `[file: ${part.filename ?? part.mediaType}]`
      if (part.type === "image") return "[image]"
      return stringify(part)
    })
    .join("\n")
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function stringify(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function makeQueue() {
  const items: QueueItem[] = []
  const waiting: Array<(item: QueueItem) => void> = []
  let textStarted = false
  let reasoningStarted = false
  const offer = (item: QueueItem) => {
    const resolve = waiting.shift()
    if (resolve) return resolve(item)
    items.push(item)
  }
  return {
    push(event: LLMEvent) {
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
      if (reasoningStarted) offer({ type: "event", event: LLMEvent.reasoningEnd({ id: REASONING_ID }) })
      if (textStarted) offer({ type: "event", event: LLMEvent.textEnd({ id: TEXT_ID }) })
      reasoningStarted = false
      textStarted = false
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
        if (item.type === "event") yield item.event
        if (item.type === "error") throw item.error
        if (item.type === "done") return
      }
    },
  }
}

export * as ClaudeACP from "./claude-acp"
