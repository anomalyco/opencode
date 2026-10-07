import type { OpenCodeClient } from "@opencode/client/effect"
import { SessionsCursor } from "@opencode/protocol/groups/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { FSUtil } from "@opencode/util/fs-util"
import { DateTime, Effect, Ref, Schema } from "effect"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import type {
  AuthenticateRequest,
  AuthenticateResponse,
  AuthMethod,
  CancelNotification,
  CloseSessionRequest,
  CloseSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  McpServer,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import { OPENCODE_VERSION } from "../version"
import { ACPCapabilities, type Capabilities } from "./capabilities"
import type { ACPCatalog } from "./catalog"
import { ACPClient } from "./client"
import { configOptions, resolveChange } from "./config-option"
import type { ACPConnection } from "./connection"
import { ACPDirectories } from "./directories"
import { ACPError } from "./error"
import { ACPReplay } from "./replay"
import type { ACPSessions, Attached, SupportedMcpServer } from "./sessions"
import type { ACPTurn } from "./turn"

const AuthMethodID = "opencode-login"

export interface Interface {
  readonly initialize: (input: InitializeRequest) => Effect.Effect<InitializeResponse>
  readonly authenticate: (input: AuthenticateRequest) => Effect.Effect<AuthenticateResponse, ACPError.Failure>
  readonly newSession: (input: NewSessionRequest) => Effect.Effect<NewSessionResponse, ACPError.Failure>
  readonly loadSession: (input: LoadSessionRequest) => Effect.Effect<LoadSessionResponse, ACPError.Failure>
  readonly listSessions: (input: ListSessionsRequest) => Effect.Effect<ListSessionsResponse, ACPError.Failure>
  readonly deleteSession: (input: DeleteSessionRequest) => Effect.Effect<DeleteSessionResponse, ACPError.Failure>
  readonly resumeSession: (input: ResumeSessionRequest) => Effect.Effect<ResumeSessionResponse, ACPError.Failure>
  readonly closeSession: (input: CloseSessionRequest) => Effect.Effect<CloseSessionResponse, ACPError.Failure>
  readonly forkSession: (input: ForkSessionRequest) => Effect.Effect<ForkSessionResponse, ACPError.Failure>
  readonly setSessionConfigOption: (
    input: SetSessionConfigOptionRequest,
  ) => Effect.Effect<SetSessionConfigOptionResponse, ACPError.Failure>
  readonly setSessionMode: (input: SetSessionModeRequest) => Effect.Effect<SetSessionModeResponse, ACPError.Failure>
  readonly prompt: (input: PromptRequest, signal: AbortSignal) => Effect.Effect<PromptResponse, ACPError.Failure>
  readonly cancel: (input: CancelNotification) => Effect.Effect<void>
}

export function make(input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Interface
  readonly catalog: ACPCatalog.Interface
  readonly sessions: ACPSessions.Interface
  readonly capabilities: Ref.Ref<Capabilities>
  readonly turn: ACPTurn.Interface
}): Interface {
  const currentOptions = Effect.fnUntraced(function* (attached: Attached) {
    return configOptions(yield* input.catalog.get(attached.cwd), yield* Ref.get(attached.selection))
  })

  const withReload = <A>(attached: Attached, attempt: Effect.Effect<A, ACPError.Failure>) => {
    const retry = () => input.catalog.reload(attached.cwd).pipe(Effect.andThen(attempt))
    return attempt.pipe(
      Effect.catchTags({ ACPInvalidModelError: retry, ACPInvalidModeError: retry, ACPInvalidEffortError: retry }),
    )
  }

  const select = Effect.fnUntraced(function* (attached: Attached, configId: string, value: string) {
    const change = yield* resolveChange(
      yield* input.catalog.get(attached.cwd),
      yield* Ref.get(attached.selection),
      configId,
      value,
    )
    yield* input.sessions.select(attached, change)
  })

  const getSession = Effect.fnUntraced(function* (sessionId: string, cwd: string) {
    const sessionID = yield* ACPClient.decodeSessionID(sessionId)
    const session = yield* input.client.session.get({ sessionID }).pipe(Effect.catch(ACPClient.classify))
    if (FSUtil.resolve(cwd) !== FSUtil.resolve(session.location.directory))
      return yield* new ACPError.SessionDirectoryMismatchError({ sessionId, cwd })
    return session
  })

  return {
    initialize: Effect.fnUntraced(function* (params) {
      yield* Ref.set(input.capabilities, ACPCapabilities.parse(params.clientCapabilities))
      const authMethod: AuthMethod = {
        description: "Run `opencode auth login` in the terminal",
        name: "Login with opencode",
        id: AuthMethodID,
        ...(params.clientCapabilities?.auth?.terminal ? { type: "terminal" as const, args: ["--login"] } : {}),
      }
      if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
        authMethod._meta = {
          "terminal-auth": { command: "opencode", args: ["auth", "login"], label: "OpenCode Login" },
        }
      }
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true, sse: false },
          promptCapabilities: { embeddedContext: true, image: true },
          sessionCapabilities: { additionalDirectories: {}, close: {}, delete: {}, fork: {}, list: {}, resume: {} },
          _meta: { [ACPCapabilities.ChildSessionUpdates]: true },
        },
        authMethods: [authMethod],
        agentInfo: { name: "OpenCode", version: OPENCODE_VERSION },
      }
    }),
    authenticate: Effect.fnUntraced(function* (params) {
      if (params.methodId !== AuthMethodID)
        return yield* new ACPError.UnknownAuthMethodError({ methodId: params.methodId })
      return {}
    }),
    newSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const mcpServers = yield* supportedMcpServers(params.mcpServers)
      // Load first so a catalog failure leaves no session.
      yield* input.catalog.get(params.cwd)
      const created = yield* input.client.session
        .create({ location: { directory: AbsolutePath.make(params.cwd) }, ...ACPDirectories.grant(directories) })
        .pipe(Effect.catch(ACPClient.classify))
      const attachment = yield* input.sessions.attach(created, params.cwd, mcpServers)
      return { sessionId: attachment.attached.id, configOptions: attachment.configOptions }
    }),
    loadSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const mcpServers = yield* supportedMcpServers(params.mcpServers)
      const session = yield* getSession(params.sessionId, params.cwd)
      yield* ACPDirectories.activate(input.client, session, directories)
      const attachment = yield* input.sessions.attach(session, session.location.directory, mcpServers)
      return yield* ACPReplay.history(
        input.client,
        input.connection,
        attachment.attached,
        yield* Ref.get(input.capabilities),
      ).pipe(
        Effect.andThen(currentOptions(attachment.attached)),
        Effect.map((configOptions) => ({ configOptions })),
        Effect.onError(() => input.sessions.release(attachment.attached)),
      )
    }),
    listSessions: Effect.fnUntraced(function* (params) {
      const page = yield* input.client.session
        .list({
          ...(params.cwd !== undefined && params.cwd !== null
            ? { directory: yield* ACPDirectories.parseCwd(params.cwd) }
            : {}),
          order: "desc",
          limit: 100,
          ...(params.cursor ? { cursor: Schema.decodeSync(SessionsCursor)(params.cursor) } : {}),
        })
        .pipe(Effect.catch(ACPClient.classify))
      return {
        sessions: page.data.map((session) => {
          const additionalDirectories = ACPDirectories.list(session)
          return {
            sessionId: session.id,
            cwd: session.location.directory,
            ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
            title: withTimestampedFallback({
              ...session,
              time: { created: DateTime.toEpochMillis(session.time.created) },
            }),
            updatedAt: DateTime.formatIso(session.time.updated),
          }
        }),
        ...(page.cursor.next ? { nextCursor: page.cursor.next } : {}),
      }
    }),
    deleteSession: Effect.fnUntraced(function* (params) {
      yield* input.turn.cancel({ sessionId: params.sessionId })
      yield* ACPClient.decodeSessionID(params.sessionId).pipe(
        Effect.flatMap((sessionID) => input.client.session.remove({ sessionID })),
        Effect.catchTag(["ACPInvalidRequestError", "SessionNotFoundError"], () => Effect.void),
        Effect.catch(ACPClient.classify),
      )
      yield* input.sessions.detach(params.sessionId)
      return {}
    }),
    resumeSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const mcpServers = yield* supportedMcpServers(params.mcpServers)
      const session = yield* getSession(params.sessionId, params.cwd)
      yield* ACPDirectories.activate(input.client, session, directories)
      const attachment = yield* input.sessions.attach(session, session.location.directory, mcpServers)
      return { configOptions: attachment.configOptions }
    }),
    closeSession: Effect.fnUntraced(function* (params) {
      yield* input.turn.close(params.sessionId)
      yield* input.sessions.detach(params.sessionId)
      return {}
    }),
    forkSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const mcpServers = yield* supportedMcpServers(params.mcpServers)
      const session = yield* getSession(params.sessionId, params.cwd)
      const forked = yield* input.client.session.fork({ sessionID: session.id }).pipe(Effect.catch(ACPClient.classify))
      // Forks inherit the source's grants; replace them with this request's.
      yield* ACPDirectories.activate(input.client, forked, directories)
      const attachment = yield* input.sessions.attach(forked, forked.location.directory, mcpServers)
      return { sessionId: attachment.attached.id, configOptions: attachment.configOptions }
    }),
    setSessionConfigOption: Effect.fnUntraced(function* (params) {
      const attached = yield* input.sessions.require(params.sessionId)
      const value = params.value
      if (typeof value !== "string") return yield* new ACPError.InvalidConfigOptionError({ configId: params.configId })
      yield* withReload(attached, select(attached, params.configId, value))
      return { configOptions: yield* currentOptions(attached) }
    }),
    setSessionMode: Effect.fnUntraced(function* (params) {
      const attached = yield* input.sessions.require(params.sessionId)
      yield* withReload(attached, select(attached, "mode", params.modeId))
      return {}
    }),
    prompt: input.turn.prompt,
    cancel: input.turn.cancel,
  }
}

const supportedMcpServers = Effect.fnUntraced(function* (servers: readonly McpServer[] = []) {
  const supported = servers.filter(
    (server): server is SupportedMcpServer => !("type" in server) || server.type === "http",
  )
  if (supported.length < servers.length)
    return yield* new ACPError.InvalidRequestError({
      message: "Only stdio and HTTP MCP servers are supported",
      field: "mcpServers",
    })
  return supported
})

export * as ACPService from "./service"
