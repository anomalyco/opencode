import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { ConfigACP } from "@/config/acp"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import * as Session from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { PartID, SessionID } from "@/session/schema"
import { Shell } from "@/shell/shell"
import { Snapshot } from "@/snapshot"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as Log from "@opencode-ai/core/util/log"
import type { InstanceContext } from "@/project/instance-context"
import {
  ClientSideConnection,
  RequestError,
  ndJsonStream,
  type Agent as ACPAgent,
  type Client as ACPClientHandler,
  type ContentBlock,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type KillTerminalRequest,
  type KillTerminalResponse,
  type InitializeResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import { Context, Effect, Layer, Scope, Schema } from "effect"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import path from "node:path"
import { Readable, Writable } from "node:stream"

const log = Log.create({ service: "acp-client" })
const DEFAULT_TIMEOUT = 30_000

const ACPStatePayload = Schema.Struct({
  sessionID: SessionID,
  configOptions: Schema.optional(Schema.Array(Schema.Any)),
  modes: Schema.optional(Schema.Any),
  models: Schema.optional(Schema.Any),
  availableCommands: Schema.optional(Schema.Array(Schema.Any)),
  usage: Schema.optional(Schema.Any),
  info: Schema.optional(Schema.Any),
})
export type ACPStatePayload = Schema.Schema.Type<typeof ACPStatePayload>

export const Event = {
  StateUpdated: BusEvent.define("acp.session.updated", ACPStatePayload),
}

type ConfiguredACP = NonNullable<Config.Info["acp"]>[string]

function isConfiguredACP(entry: ConfiguredACP | undefined): entry is ConfigACP.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

type TerminalState = {
  process: ChildProcessWithoutNullStreams
  output: string
  truncated: boolean
  outputByteLimit: number
  exitStatus?: {
    exitCode: number | null
    signal: string | null
  }
  wait: Promise<void>
}

type PendingPermission = {
  resolve: (value: RequestPermissionResponse) => void
}

type RemoteSessionState = {
  localSessionID: SessionID
  remoteSessionID: string
  server: string
  ctx: InstanceContext
  localSession: Session.Info
  assistant?: MessageV2.Assistant
  ruleset: Permission.Ruleset
  textPartID?: PartID
  textMessageID?: string
  reasoningPartID?: PartID
  reasoningMessageID?: string
  planPartID?: PartID
  tools: Map<string, PartID>
  terminals: Map<string, TerminalState>
  pendingPermissions: Set<PendingPermission>
  activeAssistantID?: MessageV2.Assistant["id"]
  configOptions?: unknown[]
  modes?: unknown
  models?: unknown
  availableCommands?: unknown[]
  usage?: unknown
  info?: unknown
}

type ConnectionState = {
  server: string
  config: ConfigACP.Info
  agent: ACPAgent
  process: ChildProcessWithoutNullStreams
  initialized: boolean
  init: InitializeResponse
}

type State = {
  connections: Map<string, ConnectionState>
  sessions: Map<SessionID, RemoteSessionState>
  remoteToLocal: Map<string, SessionID>
  terminalCounter: number
}

export interface RunInput {
  server: string
  agent: {
    name: string
    permission: Permission.Ruleset
  }
  session: Session.Info
  user: MessageV2.WithParts & { info: MessageV2.User }
  assistant: MessageV2.Assistant
}

export interface PrepareInput {
  server: string
  agent: {
    name: string
    permission: Permission.Ruleset
  }
  session: Session.Info
}

export interface Interface {
  readonly run: (input: RunInput) => Effect.Effect<MessageV2.Assistant>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prepare: (input: PrepareInput) => Effect.Effect<ACPStatePayload, Error>
  readonly setConfigOption: (input: {
    sessionID: SessionID
    configID: string
    value: string
  }) => Effect.Effect<ACPStatePayload, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ACPClient") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const permission = yield* Permission.Service
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const snapshot = yield* Snapshot.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("ACPClient.state")(function* (_ctx) {
        const result: State = {
          connections: new Map(),
          sessions: new Map(),
          remoteToLocal: new Map(),
          terminalCounter: 0,
        }
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            for (const remote of result.sessions.values()) {
              for (const terminal of remote.terminals.values()) {
                await Shell.killTree(terminal.process).catch(() => {})
              }
            }
            for (const connection of result.connections.values()) {
              await Shell.killTree(connection.process).catch(() => {})
            }
            result.sessions.clear()
            result.remoteToLocal.clear()
            result.connections.clear()
          }),
        )
        return result
      }),
    )

    const createClientHandler = (runtime: State, ctx: InstanceContext): ACPClientHandler => {
      const runWithInstance = (effect: Effect.Effect<any, any, any>) =>
        Effect.runPromise(
          effect.pipe(
            Effect.provideService(Session.Service, session),
            Effect.provideService(Bus.Service, bus),
            Effect.provideService(InstanceRef, ctx),
          ) as Effect.Effect<any, any, never>,
        )

      const resolveSession = (remoteSessionID: string) => {
        const local = runtime.remoteToLocal.get(remoteSessionID)
        return local ? runtime.sessions.get(local) : undefined
      }

      const requestPermission = async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        const remote = resolveSession(params.sessionId)
        if (!remote) {
          return { outcome: { outcome: "cancelled" } }
        }
        const patterns = permissionPatterns(params.toolCall)
        const allowOnce = params.options.find((option) => option.kind === "allow_once")
        const allowAlways = params.options.find((option) => option.kind === "allow_always")
        const reject = params.options.find((option) => option.kind === "reject_once" || option.kind === "reject_always")
        const selected = allowOnce ?? allowAlways ?? params.options.find((option) => !option.kind.startsWith("reject"))
        if (!selected) return { outcome: { outcome: "cancelled" } }

        return new Promise<RequestPermissionResponse>((resolve) => {
          const pending = { resolve }
          remote.pendingPermissions.add(pending)
          const effect = permission
            .ask({
              sessionID: remote.localSessionID,
              permission: `acp:${params.toolCall.kind ?? "other"}`,
              patterns,
              always: patterns,
              metadata: {
                server: remote.server,
                toolCall: params.toolCall,
                options: params.options,
              },
              ruleset: remote.ruleset,
            })
            .pipe(
              Effect.match({
                onFailure: () => ({
                  outcome: reject
                    ? { outcome: "selected" as const, optionId: reject.optionId }
                    : { outcome: "cancelled" as const },
                }),
                onSuccess: () => ({ outcome: { outcome: "selected" as const, optionId: selected.optionId } }),
              }),
            )

          Effect.runPromise(effect.pipe(Effect.provideService(InstanceRef, remote.ctx))).then(
            (response) => {
              remote.pendingPermissions.delete(pending)
              resolve(response)
            },
            () => {
              remote.pendingPermissions.delete(pending)
              resolve({ outcome: { outcome: "cancelled" } })
            },
          )
        })
      }

      const readTextFile = async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        const remote = resolveSession(params.sessionId)
        if (!remote) throw RequestError.invalidParams(`Unknown session: ${params.sessionId}`)
        await assertExternalDirectory(permission, remote, params.path)
        const relative = relativeToWorktree(remote.ctx, params.path)
        await Effect.runPromise(
          permission
            .ask({
              sessionID: remote.localSessionID,
              permission: "read",
              patterns: [relative],
              always: ["*"],
              metadata: { path: params.path, server: remote.server },
              ruleset: remote.ruleset,
            })
            .pipe(Effect.provideService(InstanceRef, remote.ctx)),
        )
        const content = await Effect.runPromise(
          fs.readFileStringSafe(params.path).pipe(Effect.provideService(InstanceRef, remote.ctx)),
        )
        if (content === undefined) throw RequestError.resourceNotFound(params.path)
        return { content: sliceLines(content, params.line ?? undefined, params.limit ?? undefined) }
      }

      const writeTextFile = async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        const remote = resolveSession(params.sessionId)
        if (!remote) throw RequestError.invalidParams(`Unknown session: ${params.sessionId}`)
        await assertExternalDirectory(permission, remote, params.path)
        const relative = relativeToWorktree(remote.ctx, params.path)
        await Effect.runPromise(
          permission
            .ask({
              sessionID: remote.localSessionID,
              permission: "edit",
              patterns: [relative],
              always: ["*"],
              metadata: { path: params.path, server: remote.server },
              ruleset: remote.ruleset,
            })
            .pipe(Effect.provideService(InstanceRef, remote.ctx)),
        )
        await Effect.runPromise(
          fs.writeWithDirs(params.path, params.content).pipe(Effect.provideService(InstanceRef, remote.ctx)),
        )
        return {}
      }

      const createTerminal = async (params: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
        const remote = resolveSession(params.sessionId)
        if (!remote) throw RequestError.invalidParams(`Unknown session: ${params.sessionId}`)
        await assertExternalDirectory(permission, remote, params.cwd ?? remote.ctx.directory)
        const commandText =
          params.args && params.args.length > 0
            ? [shellQuote(params.command), ...params.args.map(shellQuote)].join(" ")
            : params.command
        await Effect.runPromise(
          permission
            .ask({
              sessionID: remote.localSessionID,
              permission: "bash",
              patterns: [commandText],
              always: [params.command + " *"],
              metadata: { cwd: params.cwd, command: params.command, args: params.args, server: remote.server },
              ruleset: remote.ruleset,
            })
            .pipe(Effect.provideService(InstanceRef, remote.ctx)),
        )
        const terminalID = `acp_${++runtime.terminalCounter}`
        const shell = Shell.preferred()
        const child = spawn(shell, Shell.args(shell, commandText, params.cwd ?? remote.ctx.directory), {
          cwd: params.cwd ?? remote.ctx.directory,
          env: {
            ...process.env,
            ...Object.fromEntries((params.env ?? []).map((entry) => [entry.name, entry.value])),
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        }) as unknown as ChildProcessWithoutNullStreams
        const terminal: TerminalState = {
          process: child,
          output: "",
          truncated: false,
          outputByteLimit: params.outputByteLimit ?? 1024 * 1024,
          wait: Promise.resolve(),
        }
        const append = (chunk: Buffer) => {
          terminal.output += chunk.toString("utf8")
          if (Buffer.byteLength(terminal.output, "utf8") > terminal.outputByteLimit) {
            terminal.truncated = true
            terminal.output = trimUtf8Start(terminal.output, terminal.outputByteLimit)
          }
        }
        child.stdout.on("data", append)
        child.stderr.on("data", append)
        terminal.wait = new Promise<void>((resolve) => {
          child.once("exit", (exitCode: number | null, signal: NodeJS.Signals | null) => {
            terminal.exitStatus = { exitCode, signal }
            resolve()
          })
          child.once("error", (error: Error) => {
            terminal.output += String(error)
            terminal.exitStatus = { exitCode: 1, signal: null }
            resolve()
          })
        })
        remote.terminals.set(terminalID, terminal)
        return { terminalId: terminalID }
      }

      const getTerminal = (params: { sessionId: string; terminalId: string }) => {
        const remote = resolveSession(params.sessionId)
        const terminal = remote?.terminals.get(params.terminalId)
        if (!remote || !terminal) throw RequestError.invalidParams(`Unknown terminal: ${params.terminalId}`)
        return { remote, terminal }
      }

      return {
        requestPermission,
        sessionUpdate: (params) => runWithInstance(handleSessionUpdate(runtime, params)),
        readTextFile,
        writeTextFile,
        createTerminal,
        terminalOutput: async (params: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
          const { terminal } = getTerminal(params)
          return {
            output: terminal.output,
            truncated: terminal.truncated,
            ...(terminal.exitStatus ? { exitStatus: terminal.exitStatus } : {}),
          }
        },
        waitForTerminalExit: async (params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> => {
          const { terminal } = getTerminal(params)
          await terminal.wait
          return terminal.exitStatus ?? { exitCode: null, signal: null }
        },
        killTerminal: async (params: KillTerminalRequest): Promise<KillTerminalResponse> => {
          const { terminal } = getTerminal(params)
          await Shell.killTree(terminal.process)
          await terminal.wait
          return {}
        },
        releaseTerminal: async (params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
          const { remote, terminal } = getTerminal(params)
          await Shell.killTree(terminal.process).catch(() => {})
          remote.terminals.delete(params.terminalId)
          return {}
        },
      }
    }

    const connect = Effect.fn("ACPClient.connect")(function* (server: string) {
      const runtime = yield* InstanceState.get(state)
      const existing = runtime.connections.get(server)
      if (existing && existing.initialized && !existing.process.killed && existing.process.exitCode === null)
        return existing
      if (existing) runtime.connections.delete(server)

      const cfg = yield* config.get()
      const serverConfig = cfg.acp?.[server]
      if (!isConfiguredACP(serverConfig) || serverConfig.enabled === false) {
        throw new Error(`ACP server not configured or disabled: ${server}`)
      }
      if (serverConfig.command.length === 0) throw new Error(`ACP server ${server} has an empty command`)

      const [command, ...args] = serverConfig.command
      const ctx = yield* InstanceState.context
      const child = spawn(command!, args, {
        cwd: ctx.directory,
        env: { ...process.env, ...serverConfig.environment },
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      }) as unknown as ChildProcessWithoutNullStreams
      child.stderr.on("data", (chunk) => log.info("server stderr", { server, text: chunk.toString("utf8") }))

      const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
      const output = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
      const stream = ndJsonStream(input, output)
      const connection = new ClientSideConnection(() => createClientHandler(runtime, ctx), stream)
      const entry: ConnectionState = {
        server,
        config: serverConfig,
        agent: connection,
        process: child,
        initialized: false,
        init: {
          protocolVersion: 1,
          agentCapabilities: {},
          authMethods: [],
        },
      }
      child.once("exit", () => {
        if (runtime.connections.get(server) === entry) runtime.connections.delete(server)
      })

      yield* Effect.tryPromise({
        try: async () => {
          try {
            const init = await withTimeout(
              connection.initialize({
                protocolVersion: 1,
                clientCapabilities: {
                  fs: { readTextFile: true, writeTextFile: true },
                  terminal: true,
                },
                clientInfo: {
                  name: "opencode",
                  title: "opencode",
                  version: InstallationVersion,
                },
              }),
              serverConfig.timeout ?? DEFAULT_TIMEOUT,
            )
            if (init.protocolVersion !== 1) {
              throw new Error(`Unsupported ACP protocol version: ${init.protocolVersion}`)
            }
            entry.init = init
          } catch (error) {
            runtime.connections.delete(server)
            await Shell.killTree(child).catch(() => {})
            throw error
          }
        },
        catch: (error) => new Error(`Failed to initialize ACP server ${server}: ${errorMessage(error)}`),
      })
      entry.initialized = true
      runtime.connections.set(server, entry)
      return entry
    })

    const ensureRemoteSession = Effect.fn("ACPClient.ensureRemoteSession")(function* (input: {
      server: string
      agent: { name: string; permission: Permission.Ruleset }
      session: Session.Info
      assistant?: MessageV2.Assistant
    }) {
      const runtime = yield* InstanceState.get(state)
      const existing = runtime.sessions.get(input.session.id)
      if (existing && existing.server === input.server) {
        if (input.assistant) {
          existing.assistant = input.assistant
          existing.activeAssistantID = input.assistant.id
          existing.textPartID = undefined
          existing.textMessageID = undefined
          existing.reasoningPartID = undefined
          existing.reasoningMessageID = undefined
          existing.planPartID = undefined
          existing.tools = new Map()
        }
        existing.localSession = input.session
        existing.ruleset = Permission.merge(input.agent.permission, input.session.permission ?? [])
        return existing
      }

      if (existing) {
        yield* Effect.promise(() => cleanupRemoteSession(runtime, existing))
        runtime.sessions.delete(input.session.id)
      }

      const connection = yield* connect(input.server)
      const ctx = yield* InstanceState.context
      const created = yield* Effect.tryPromise({
        try: () =>
          retryACPRequest(
            () =>
              connection.agent.newSession({
                cwd: ctx.directory,
                mcpServers: [],
              }),
            connection.config.timeout ?? DEFAULT_TIMEOUT,
          ),
        catch: (error) => new Error(`Failed to create ACP session on ${input.server}: ${errorMessage(error)}`),
      })
      const remote: RemoteSessionState = {
        localSessionID: input.session.id,
        remoteSessionID: created.sessionId,
        server: input.server,
        ctx,
        localSession: input.session,
        assistant: input.assistant,
        ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        tools: new Map(),
        terminals: new Map(),
        pendingPermissions: new Set(),
        activeAssistantID: input.assistant?.id,
        configOptions: Array.isArray((created as any).configOptions) ? (created as any).configOptions : undefined,
        modes: (created as any).modes,
        models: (created as any).models,
      }
      runtime.sessions.set(input.session.id, remote)
      runtime.remoteToLocal.set(created.sessionId, input.session.id)
      yield* publishACPState(bus, remote)
      return remote
    })

    const prepare = Effect.fn("ACPClient.prepare")(function* (input: PrepareInput) {
      const remote = yield* ensureRemoteSession({
        server: input.server,
        agent: input.agent,
        session: input.session,
      })
      return {
        sessionID: remote.localSessionID,
        configOptions: remote.configOptions,
        modes: remote.modes,
        models: remote.models,
        availableCommands: remote.availableCommands,
        usage: remote.usage,
        info: remote.info,
      }
    })

    const run = Effect.fn("ACPClient.run")(function* (input: RunInput) {
      const failAssistant = (error: unknown) =>
        Effect.gen(function* () {
          input.assistant.error = MessageV2.fromError(error, {
            providerID: input.assistant.providerID,
            aborted: isAbortError(error),
          })
          input.assistant.finish = isAbortError(error) ? "cancelled" : "error"
          input.assistant.time.completed = Date.now()
          yield* session.updateMessage(input.assistant)
          return input.assistant
        })

      return yield* Effect.gen(function* () {
        const connection = yield* connect(input.server)
        const remote = yield* ensureRemoteSession({
          server: input.server,
          agent: input.agent,
          session: input.session,
          assistant: input.assistant,
        })
        const startSnapshot = yield* snapshot.track()
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: input.assistant.id,
          sessionID: input.session.id,
          snapshot: startSnapshot,
          type: "step-start",
        })
        return yield* Effect.tryPromise({
          try: () =>
            connection.agent.prompt({
              sessionId: remote.remoteSessionID,
              prompt: promptParts(input.user.parts, connection.init),
            }),
          catch: (error) => error,
        }).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.gen(function* () {
                yield* finishOpenParts(session, remote)
                yield* failOpenTools(session, remote, "ACP prompt failed")
                yield* recordACPFailurePatch(session, snapshot, remote, startSnapshot)
                clearActiveTurn(remote, input.assistant.id)
                return yield* failAssistant(error)
              }),
            onSuccess: (result) =>
              Effect.gen(function* () {
                yield* finishOpenParts(session, remote)
                yield* ensureVisibleResponse(session, remote)
                yield* recordACPStepFinish({
                  session,
                  snapshot,
                  summary,
                  remote,
                  startSnapshot,
                  reason: finishReason(result.stopReason),
                  userMessageID: input.user.info.id,
                })
                clearActiveTurn(remote, input.assistant.id)
                input.assistant.finish = finishReason(result.stopReason)
                input.assistant.time.completed = Date.now()
                yield* session.updateMessage(input.assistant)
                return input.assistant
              }),
          }),
        )
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (!input.assistant.time.completed) {
              return yield* failAssistant(error)
            }
            return input.assistant
          }),
        ),
      )
    })

    const cancel = Effect.fn("ACPClient.cancel")(function* (sessionID: SessionID) {
      const runtime = yield* InstanceState.get(state)
      const remote = runtime.sessions.get(sessionID)
      if (!remote) return
      for (const pending of remote.pendingPermissions) {
        pending.resolve({ outcome: { outcome: "cancelled" } })
      }
      remote.pendingPermissions.clear()
      yield* finishOpenParts(session, remote)
      yield* failOpenTools(session, remote, "ACP prompt cancelled")
      if (remote.assistant) clearActiveTurn(remote, remote.assistant.id)
      const connection = runtime.connections.get(remote.server)
      if (!connection) return
      yield* Effect.promise(() => connection.agent.cancel({ sessionId: remote.remoteSessionID })).pipe(Effect.ignore)
    })

    const setConfigOption = Effect.fn("ACPClient.setConfigOption")(function* (input: {
      sessionID: SessionID
      configID: string
      value: string
    }) {
      const runtime = yield* InstanceState.get(state)
      const remote = runtime.sessions.get(input.sessionID)
      if (!remote) throw new Error(`ACP session not found: ${input.sessionID}`)
      const connection = yield* connect(remote.server)
      const hasConfigOption = remote.configOptions?.some((option: any) => option?.id === input.configID) === true
      if (hasConfigOption) {
        if (!connection.agent.setSessionConfigOption) throw new Error(`ACP server does not support session/set_config_option: ${remote.server}`)
        const response = yield* Effect.tryPromise({
          try: () =>
            connection.agent.setSessionConfigOption!({
              sessionId: remote.remoteSessionID,
              configId: input.configID,
              value: input.value,
            }),
          catch: (error) => new Error(`Failed to set ACP config option: ${errorMessage(error)}`),
        })
        remote.configOptions = response.configOptions
        if (input.configID === "mode") remote.modes = { ...asRecord(remote.modes), currentModeId: input.value }
        if (input.configID === "model") remote.models = { ...asRecord(remote.models), currentModelId: input.value }
      } else if (input.configID === "mode") {
        if (!connection.agent.setSessionMode) throw new Error(`ACP server does not support session/set_mode: ${remote.server}`)
        yield* Effect.tryPromise({
          try: () => connection.agent.setSessionMode!({ sessionId: remote.remoteSessionID, modeId: input.value }),
          catch: (error) => new Error(`Failed to set ACP mode: ${errorMessage(error)}`),
        })
        remote.modes = { ...asRecord(remote.modes), currentModeId: input.value }
      } else if (input.configID === "model") {
        if (!connection.agent.unstable_setSessionModel) throw new Error(`ACP server does not support session/set_model: ${remote.server}`)
        yield* Effect.tryPromise({
          try: () => connection.agent.unstable_setSessionModel!({ sessionId: remote.remoteSessionID, modelId: input.value }),
          catch: (error) => new Error(`Failed to set ACP model: ${errorMessage(error)}`),
        })
        remote.models = { ...asRecord(remote.models), currentModelId: input.value }
      } else {
        throw new Error(`ACP server does not support config option: ${input.configID}`)
      }
      yield* publishACPState(bus, remote)
      return {
        sessionID: remote.localSessionID,
        configOptions: remote.configOptions,
        modes: remote.modes,
        models: remote.models,
        availableCommands: remote.availableCommands,
        usage: remote.usage,
        info: remote.info,
      }
    })

    return Service.of({
      run: (input) => run(input).pipe(Effect.onInterrupt(() => cancel(input.session.id))),
      cancel,
      prepare,
      setConfigOption,
    })
  }),
)

function handleSessionUpdate(runtime: State, params: SessionNotification) {
  return Effect.gen(function* () {
    const local = runtime.remoteToLocal.get(params.sessionId)
    if (!local) return
    const remote = runtime.sessions.get(local)
    if (!remote) return
    if (remote.remoteSessionID !== params.sessionId) return
    const bus = yield* Bus.Service
    const update = params.update as Record<string, any>
    switch (update.sessionUpdate) {
      case "available_commands_update":
        remote.availableCommands = Array.isArray(update.availableCommands) ? update.availableCommands : []
        yield* publishACPState(bus, remote)
        return
      case "config_option_update":
        remote.configOptions = Array.isArray(update.configOptions) ? update.configOptions : []
        yield* publishACPState(bus, remote)
        return
      case "current_mode_update":
        remote.modes = {
          ...(asRecord(remote.modes) ?? {}),
          currentModeId: update.modeId,
        }
        yield* publishACPState(bus, remote)
        return
      case "session_info_update":
        remote.info = {
          ...(asRecord(remote.info) ?? {}),
          ...update,
        }
        if (typeof update.title === "string") {
          const svc = yield* Session.Service
          yield* svc.setTitle({ sessionID: remote.localSessionID, title: update.title })
        }
        yield* publishACPState(bus, remote)
        return
      case "usage_update":
        remote.usage = update
        yield* publishACPState(bus, remote)
        return
    }
    if (!remote.assistant || !remote.activeAssistantID || remote.activeAssistantID !== remote.assistant.id) return
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        yield* appendContent(
          remote,
          update.content,
          typeof update.messageId === "string" ? update.messageId : undefined,
        )
        return
      case "agent_thought_chunk":
        yield* appendReasoning(
          remote,
          update.content,
          typeof update.messageId === "string" ? update.messageId : undefined,
        )
        return
      case "tool_call":
        closeStreamingText(remote)
        yield* upsertTool(remote, update)
        return
      case "tool_call_update":
        closeStreamingText(remote)
        yield* upsertTool(remote, update)
        return
      case "plan":
        closeStreamingText(remote)
        yield* upsertPlan(remote, update.entries ?? [])
        return
      default:
        return
    }
  })
}

async function cleanupRemoteSession(runtime: State, remote: RemoteSessionState) {
  runtime.remoteToLocal.delete(remote.remoteSessionID)
  for (const pending of remote.pendingPermissions) {
    pending.resolve({ outcome: { outcome: "cancelled" } })
  }
  remote.pendingPermissions.clear()
  for (const terminal of remote.terminals.values()) {
    await Shell.killTree(terminal.process).catch(() => {})
  }
  remote.terminals.clear()
  const connection = runtime.connections.get(remote.server)
  if (connection?.agent.closeSession) {
    await connection.agent.closeSession({ sessionId: remote.remoteSessionID }).catch(() => {})
  }
}

function clearActiveTurn(remote: RemoteSessionState, assistantID: MessageV2.Assistant["id"]) {
  if (remote.activeAssistantID === assistantID) remote.activeAssistantID = undefined
}

function publishACPState(bus: Bus.Interface, remote: RemoteSessionState) {
  return bus.publish(Event.StateUpdated, {
    sessionID: remote.localSessionID,
    configOptions: remote.configOptions,
    modes: remote.modes,
    models: remote.models,
    availableCommands: remote.availableCommands,
    usage: remote.usage,
    info: remote.info,
  })
}

function recordACPFailurePatch(
  svc: Session.Interface,
  snapshot: Snapshot.Interface,
  remote: RemoteSessionState,
  startSnapshot: string | undefined,
) {
  return Effect.gen(function* () {
    if (!startSnapshot) return
    if (!remote.assistant) return
    const assistant = remote.assistant
    const patch = yield* snapshot.patch(startSnapshot)
    if (!patch.files.length) return
    yield* svc.updatePart({
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID: remote.localSessionID,
      type: "patch",
      hash: patch.hash,
      files: patch.files,
    })
  })
}

function recordACPStepFinish(input: {
  session: Session.Interface
  snapshot: Snapshot.Interface
  summary: SessionSummary.Interface
  remote: RemoteSessionState
  startSnapshot: string | undefined
  reason: string
  userMessageID: MessageV2.User["id"]
}) {
  return Effect.gen(function* () {
    if (!input.remote.assistant) return
    const assistant = input.remote.assistant
    const completedSnapshot = yield* input.snapshot.track()
    yield* input.session.updatePart({
      id: PartID.ascending(),
      reason: input.reason,
      snapshot: completedSnapshot,
      messageID: assistant.id,
      sessionID: input.remote.localSessionID,
      type: "step-finish",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      cost: 0,
    })
    if (input.startSnapshot) {
      const patch = yield* input.snapshot.patch(input.startSnapshot)
      if (patch.files.length) {
        yield* input.session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: input.remote.localSessionID,
          type: "patch",
          hash: patch.hash,
          files: patch.files,
        })
      }
    }
    yield* input.summary
      .summarize({ sessionID: input.remote.localSessionID, messageID: input.userMessageID })
      .pipe(Effect.ignore)
  })
}

function finishOpenParts(svc: Session.Interface, remote: RemoteSessionState) {
  return Effect.gen(function* () {
    if (!remote.assistant) return
    const assistant = remote.assistant
    const now = Date.now()
    if (remote.textPartID) {
      const current = yield* svc.getPart({
        sessionID: remote.localSessionID,
        messageID: assistant.id,
        partID: remote.textPartID,
      })
      if (current?.type === "text" && current.time?.end === undefined) {
        yield* svc.updatePart({
          ...current,
          time: { start: current.time?.start ?? assistant.time.created, end: now },
        })
      }
    }
    if (remote.reasoningPartID) {
      const current = yield* svc.getPart({
        sessionID: remote.localSessionID,
        messageID: assistant.id,
        partID: remote.reasoningPartID,
      })
      if (current?.type === "reasoning" && current.time.end === undefined) {
        yield* svc.updatePart({
          ...current,
          time: { start: current.time.start, end: now },
        })
      }
    }
  })
}

function failOpenTools(svc: Session.Interface, remote: RemoteSessionState, message: string) {
  return Effect.gen(function* () {
    if (!remote.assistant) return
    const assistant = remote.assistant
    const now = Date.now()
    for (const partID of remote.tools.values()) {
      const current = yield* svc.getPart({
        sessionID: remote.localSessionID,
        messageID: assistant.id,
        partID,
      })
      if (!current || current.type !== "tool") continue
      if (current.state.status !== "pending" && current.state.status !== "running") continue
      const start = "time" in current.state ? current.state.time.start : now
      yield* svc.updatePart({
        ...current,
        state: {
          status: "error",
          input: current.state.input,
          error: message,
          metadata: "metadata" in current.state ? current.state.metadata : undefined,
          time: { start, end: now },
        },
      })
    }
  })
}

function ensureVisibleResponse(svc: Session.Interface, remote: RemoteSessionState) {
  return Effect.gen(function* () {
    if (!remote.assistant) return
    const assistant = remote.assistant
    const messages = yield* svc.messages({ sessionID: remote.localSessionID, limit: 1 }).pipe(Effect.orDie)
    const current = messages.find((message) => message.info.id === assistant.id)
    const visible = current?.parts.some((part) => {
      if (part.type === "text") return !part.synthetic && !part.ignored && part.text.trim().length > 0
      if (part.type === "reasoning") return part.text.trim().length > 0
      if (part.type === "tool") return true
      if (part.type === "file") return true
      return false
    })
    if (visible) return
    const now = Date.now()
    yield* svc.updatePart({
      id: PartID.ascending(),
      sessionID: remote.localSessionID,
      messageID: assistant.id,
      type: "text",
      text: "Done.",
      metadata: { acp: { fallback: true } },
      time: { start: now, end: now },
    })
  })
}

function closeStreamingText(remote: RemoteSessionState) {
  remote.textPartID = undefined
  remote.textMessageID = undefined
}

function appendContent(remote: RemoteSessionState, content: unknown, messageID?: string) {
  return Effect.gen(function* () {
    if (!remote.assistant) return
    const assistant = remote.assistant
    const file = contentBlockFilePart(remote, content)
    if (file) {
      const svc = yield* Session.Service
      yield* svc.updatePart({
        ...file,
        id: PartID.ascending(),
        sessionID: remote.localSessionID,
        messageID: assistant.id,
      })
      return
    }
    const text = contentBlockText(content)
    if (!text) return
    const svc = yield* Session.Service
    if (messageID && remote.textMessageID && remote.textMessageID !== messageID) closeStreamingText(remote)
    if (!remote.textPartID) {
      const part = yield* svc.updatePart({
        id: PartID.ascending(),
        sessionID: remote.localSessionID,
        messageID: assistant.id,
        type: "text",
        text,
        time: { start: Date.now() },
      })
      remote.textPartID = part.id
      remote.textMessageID = messageID
      return
    }
    const current = yield* svc.getPart({
      sessionID: remote.localSessionID,
      messageID: assistant.id,
      partID: remote.textPartID,
    })
    if (!current || current.type !== "text") return
    yield* svc.updatePart({ ...current, text: current.text + text })
  })
}

function appendReasoning(remote: RemoteSessionState, content: unknown, messageID?: string) {
  return Effect.gen(function* () {
    if (!remote.assistant) return
    const assistant = remote.assistant
    const text = contentBlockText(content)
    if (!text) return
    const svc = yield* Session.Service
    if (messageID && remote.reasoningMessageID && remote.reasoningMessageID !== messageID) {
      remote.reasoningPartID = undefined
      remote.reasoningMessageID = undefined
    }
    if (!remote.reasoningPartID) {
      const part = yield* svc.updatePart({
        id: PartID.ascending(),
        sessionID: remote.localSessionID,
        messageID: assistant.id,
        type: "reasoning",
        text,
        time: { start: Date.now() },
      })
      remote.reasoningPartID = part.id
      remote.reasoningMessageID = messageID
      return
    }
    const current = yield* svc.getPart({
      sessionID: remote.localSessionID,
      messageID: assistant.id,
      partID: remote.reasoningPartID,
    })
    if (!current || current.type !== "reasoning") return
    yield* svc.updatePart({ ...current, text: current.text + text })
  })
}

function upsertPlan(remote: RemoteSessionState, entries: Array<Record<string, unknown>>) {
  return Effect.gen(function* () {
    if (!remote.assistant) return
    const assistant = remote.assistant
    const text = entries
      .map((entry) => {
        const status = typeof entry.status === "string" ? ` [${entry.status}]` : ""
        return `- ${String(entry.content ?? "")}${status}`
      })
      .join("\n")
    if (!text) return
    const svc = yield* Session.Service
    const value = `Plan:\n${text}`
    if (!remote.planPartID) {
      const part = yield* svc.updatePart({
        id: PartID.ascending(),
        sessionID: remote.localSessionID,
        messageID: assistant.id,
        type: "text",
        text: value,
        synthetic: true,
        metadata: { acp: { kind: "plan" } },
        time: { start: Date.now(), end: Date.now() },
      })
      remote.planPartID = part.id
      return
    }
    const current = yield* svc.getPart({
      sessionID: remote.localSessionID,
      messageID: assistant.id,
      partID: remote.planPartID,
    })
    if (!current || current.type !== "text") return
    yield* svc.updatePart({ ...current, text: value })
  })
}

function upsertTool(remote: RemoteSessionState, update: Record<string, any>) {
  return Effect.gen(function* () {
    if (!remote.assistant) return
    const assistant = remote.assistant
    const toolCallID = String(update.toolCallId)
    const svc = yield* Session.Service
    const existingID = remote.tools.get(toolCallID)
    const now = Date.now()
    if (!existingID) {
      const status = toolStatus(update.status)
      const input = asRecord(update.rawInput)
      const part = yield* svc.updatePart({
        id: PartID.ascending(),
        sessionID: remote.localSessionID,
        messageID: assistant.id,
        type: "tool",
        callID: toolCallID,
        tool: `acp:${update.kind ?? "tool"}`,
        state:
          status === "pending"
            ? { status: "pending", input, raw: JSON.stringify(update.rawInput ?? {}) }
            : {
                status: status === "running" ? "running" : status === "completed" ? "completed" : "error",
                input,
                ...(status === "running"
                  ? { title: update.title, metadata: asRecord(update.rawInput), time: { start: now } }
                  : status === "completed"
                    ? {
                        title: update.title ?? "ACP tool",
                        output: toolOutput(update, remote),
                        metadata: asRecord(update.rawOutput),
                        time: { start: now, end: now },
                      }
                    : {
                        error: toolOutput(update, remote) || "ACP tool failed",
                        metadata: asRecord(update.rawOutput),
                        time: { start: now, end: now },
                      }),
              },
        metadata: {
          providerExecuted: true,
          acp: {
            server: remote.server,
            kind: update.kind,
            title: update.title,
            locations: update.locations,
            content: update.content,
            rawInput: update.rawInput,
            rawOutput: update.rawOutput,
          },
        },
      } as MessageV2.ToolPart)
      remote.tools.set(toolCallID, part.id)
      return
    }
    const current = yield* svc.getPart({
      sessionID: remote.localSessionID,
      messageID: remote.assistant.id,
      partID: existingID,
    })
    if (!current || current.type !== "tool") return
    const status = toolStatus(update.status, current.state.status)
    const input = update.rawInput === undefined ? current.state.input : asRecord(update.rawInput)
    const start = "time" in current.state ? current.state.time.start : now
    yield* svc.updatePart({
      ...current,
      state:
        status === "pending"
          ? { status: "pending", input, raw: JSON.stringify(update.rawInput ?? current.state.input ?? {}) }
          : status === "running"
            ? { status: "running", input, title: update.title, metadata: asRecord(update.rawInput), time: { start } }
            : status === "completed"
              ? {
                  status: "completed",
                  input,
                  title: update.title ?? current.tool,
                  output: toolOutput(update, remote) || ("output" in current.state ? current.state.output : ""),
                  metadata:
                    update.rawOutput === undefined && "metadata" in current.state
                      ? (current.state.metadata ?? {})
                      : asRecord(update.rawOutput),
                  time: { start, end: now },
                }
              : {
                  status: "error",
                  input,
                  error:
                    toolOutput(update, remote) || ("error" in current.state ? current.state.error : "ACP tool failed"),
                  metadata:
                    update.rawOutput === undefined && "metadata" in current.state
                      ? current.state.metadata
                      : asRecord(update.rawOutput),
                  time: { start, end: now },
                },
    })
  })
}

function promptParts(parts: MessageV2.Part[], init: InitializeResponse): ContentBlock[] {
  const result: ContentBlock[] = []
  const capabilities = init.agentCapabilities?.promptCapabilities
  for (const part of parts) {
    if (part.type === "text") {
      if (part.ignored) continue
      result.push({
        type: "text",
        text: part.text,
        ...((part.synthetic || part.ignored) && {
          annotations: { audience: part.synthetic ? ["assistant"] : ["user"] },
        }),
      } as ContentBlock)
      continue
    }
    if (part.type !== "file") continue
    if (part.url.startsWith("file://")) {
      result.push({
        type: "resource_link",
        uri: part.url,
        name: part.filename ?? path.basename(part.url),
        mimeType: part.mime,
      } as ContentBlock)
      continue
    }
    if (part.url.startsWith("data:")) {
      const match = part.url.match(/^data:([^;]+);base64,(.*)$/)
      const mimeType = match?.[1] ?? part.mime
      const data = match?.[2] ?? ""
      if (mimeType.startsWith("image/")) {
        if (!capabilities?.image) continue
        result.push({ type: "image", mimeType, data } as ContentBlock)
      } else {
        if (!capabilities?.embeddedContext) continue
        result.push({
          type: "resource",
          resource: { uri: part.filename ?? "file", mimeType, blob: data },
        } as ContentBlock)
      }
    }
  }
  return result
}

function contentBlockText(content: unknown): string {
  if (!content || typeof content !== "object") return ""
  const block = content as Record<string, any>
  if (block.type === "text") return String(block.text ?? "")
  if (block.type === "resource" && block.resource && typeof block.resource.text === "string") return block.resource.text
  return ""
}

function contentBlockFilePart(
  remote: RemoteSessionState,
  content: unknown,
): Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID"> | undefined {
  if (!content || typeof content !== "object") return
  const block = content as Record<string, any>
  if (block.type === "resource_link" && typeof block.uri === "string") {
    return {
      type: "file",
      url: block.uri,
      filename: typeof block.name === "string" ? block.name : block.uri,
      mime: typeof block.mimeType === "string" ? block.mimeType : "application/octet-stream",
      source: {
        type: "resource",
        text: { value: "", start: 0, end: 0 },
        clientName: remote.server,
        uri: block.uri,
      },
    }
  }
  if (block.type === "image" && typeof block.mimeType === "string" && typeof block.data === "string") {
    return {
      type: "file",
      url: `data:${block.mimeType};base64,${block.data}`,
      filename: typeof block.uri === "string" ? path.basename(block.uri) : "image",
      mime: block.mimeType,
    }
  }
  if (block.type === "resource" && block.resource && typeof block.resource === "object") {
    const resource = block.resource as Record<string, any>
    if (typeof resource.blob !== "string") return
    const mime = typeof resource.mimeType === "string" ? resource.mimeType : "application/octet-stream"
    const uri = typeof resource.uri === "string" ? resource.uri : "resource"
    return {
      type: "file",
      url: `data:${mime};base64,${resource.blob}`,
      filename: path.basename(uri),
      mime,
      source: {
        type: "resource",
        text: { value: "", start: 0, end: 0 },
        clientName: remote.server,
        uri,
      },
    }
  }
}

function toolOutput(update: Record<string, any>, remote?: RemoteSessionState) {
  if (typeof update.rawOutput === "string") return update.rawOutput
  if (update.rawOutput !== undefined) return JSON.stringify(update.rawOutput)
  if (Array.isArray(update.content))
    return update.content
      .map((item) => toolContentText(item, remote))
      .filter(Boolean)
      .join("\n")
  return ""
}

function toolContentText(value: unknown, remote?: RemoteSessionState): string {
  if (!value || typeof value !== "object") return ""
  const item = value as Record<string, any>
  if (item.type === "content") return contentBlockText(item.content)
  if (item.type === "diff") return `Diff: ${item.path ?? ""}`
  if (item.type === "terminal") {
    const terminalID = typeof item.terminalId === "string" ? item.terminalId : ""
    const terminal = terminalID ? remote?.terminals.get(terminalID) : undefined
    const output = terminal?.output.trim()
    return output ? `Terminal ${terminalID}:\n${output}` : `Terminal: ${terminalID}`
  }
  return ""
}

function permissionPatterns(toolCall: RequestPermissionRequest["toolCall"]) {
  const locations = Array.isArray(toolCall.locations) ? toolCall.locations : []
  const paths = locations.map((location) => location.path).filter((item): item is string => typeof item === "string")
  return paths.length ? paths : [toolCall.title ?? toolCall.toolCallId ?? "*"]
}

async function assertExternalDirectory(
  permission: Permission.Interface,
  remote: RemoteSessionState,
  targetPath: string,
) {
  const resolved = path.resolve(targetPath)
  if (AppFileSystem.contains(remote.ctx.worktree, resolved)) return
  const pattern = path.join(path.dirname(resolved), "*").replaceAll("\\", "/")
  await Effect.runPromise(
    permission
      .ask({
        sessionID: remote.localSessionID,
        permission: "external_directory",
        patterns: [pattern],
        always: [pattern],
        metadata: { path: resolved, server: remote.server },
        ruleset: remote.ruleset,
      })
      .pipe(Effect.provideService(InstanceRef, remote.ctx)),
  )
}

function toolStatus(status: unknown, fallback: "pending" | "running" | "completed" | "error" = "pending") {
  if (status === undefined) return fallback
  if (status === "in_progress") return "running"
  if (status === "completed") return "completed"
  if (status === "failed" || status === "error") return "error"
  return "pending"
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function finishReason(reason: string) {
  if (reason === "end_turn") return "stop"
  if (reason === "cancelled") return "cancelled"
  return reason
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sliceLines(content: string, line?: number, limit?: number) {
  if (!line && !limit) return content
  const lines = content.split("\n")
  const start = Math.max((line ?? 1) - 1, 0)
  const end = limit && limit > 0 ? start + limit : undefined
  return lines.slice(start, end).join("\n")
}

function trimUtf8Start(value: string, maxBytes: number) {
  let output = value
  while (Buffer.byteLength(output, "utf8") > maxBytes && output.length > 0) {
    output = output.slice(Math.max(1, output.length - maxBytes))
  }
  return output
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

function relativeToWorktree(ctx: InstanceContext, filepath: string) {
  return path.relative(ctx.worktree, filepath).replaceAll("\\", "/")
}

function withTimeout<T>(promise: Promise<T>, timeout: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeout}ms`)), timeout)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function retryACPRequest<T>(request: () => Promise<T>, timeout: number) {
  const delays = [0, 250, 1000, 2000]
  let lastError: unknown
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      return await withTimeout(request(), timeout)
    } catch (error) {
      lastError = error
      if (!isRetryableACPError(error)) break
    }
  }
  throw lastError
}

function isRetryableACPError(error: unknown) {
  const message = errorMessage(error).toLowerCase()
  return message.includes("internal error") || message.includes("-32603")
}

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Permission.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Snapshot.defaultLayer),
  Layer.provide(SessionSummary.defaultLayer),
  Layer.provide(Bus.layer),
)

export * as ACPClient from "./client"
