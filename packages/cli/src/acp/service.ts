import type { OpenCodeClient } from "@opencode/client/effect"
import { SessionsCursor } from "@opencode/protocol/groups/session"
import { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { FSUtil } from "@opencode/util/fs-util"
import { DateTime, Effect, Option, Ref, Result, Schema, Stream } from "effect"
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
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  RequestError,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import { OPENCODE_VERSION } from "../version"
import type { ACPCatalog, Catalog } from "./catalog"
import { ACPClient } from "./client"
import { configOptions, currentModel, DEFAULT_VARIANT_VALUE, parseModelSelection } from "./config-option"
import type { ACPConnection } from "./connection"
import { ACPDirectories } from "./directories"
import { ACPError } from "./error"
import type { ACPSessions, Attached } from "./sessions"
import { ACPTranslate } from "./translate"
import type { ACPTurn } from "./turn"

export const AuthMethodID = "opencode-login"

export type Failure = ACPError.Error | RequestError | ACPCatalog.Error

/** What the client advertised in `initialize`. */
export type Capabilities = {
  readonly childSessionUpdates: boolean
  readonly formElicitation: boolean
  readonly compaction: boolean
}

export interface Interface {
  readonly initialize: (input: InitializeRequest) => Effect.Effect<InitializeResponse>
  readonly authenticate: (input: AuthenticateRequest) => Effect.Effect<AuthenticateResponse, Failure>
  readonly newSession: (input: NewSessionRequest) => Effect.Effect<NewSessionResponse, Failure>
  readonly loadSession: (input: LoadSessionRequest) => Effect.Effect<LoadSessionResponse, Failure>
  readonly listSessions: (input: ListSessionsRequest) => Effect.Effect<ListSessionsResponse, Failure>
  readonly deleteSession: (input: DeleteSessionRequest) => Effect.Effect<DeleteSessionResponse, Failure>
  readonly resumeSession: (input: ResumeSessionRequest) => Effect.Effect<ResumeSessionResponse, Failure>
  readonly closeSession: (input: CloseSessionRequest) => Effect.Effect<CloseSessionResponse, Failure>
  readonly forkSession: (input: ForkSessionRequest) => Effect.Effect<ForkSessionResponse, Failure>
  readonly setSessionConfigOption: (
    input: SetSessionConfigOptionRequest,
  ) => Effect.Effect<SetSessionConfigOptionResponse, Failure>
  readonly setSessionMode: (input: SetSessionModeRequest) => Effect.Effect<SetSessionModeResponse, Failure>
  readonly prompt: (input: PromptRequest, signal: AbortSignal) => Effect.Effect<PromptResponse, Failure>
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

  // A selection the catalog has not seen may be new on the server, so reload once before rejecting it.
  const withReload = <A>(attached: Attached, select: Effect.Effect<A, Failure>) => {
    const retry = () => input.catalog.reload(attached.cwd).pipe(Effect.andThen(select))
    return select.pipe(
      Effect.catchTags({ ACPInvalidModelError: retry, ACPInvalidModeError: retry, ACPInvalidEffortError: retry }),
    )
  }

  const selectOption = Effect.fnUntraced(function* (attached: Attached, configId: string, value: string) {
    const catalog = yield* input.catalog.get(attached.cwd)
    const current = currentModel(catalog, yield* Ref.get(attached.selection))
    switch (configId) {
      case "model":
        return yield* selectModel(attached, yield* requireModel(catalog, value, current))
      case "effort":
        return yield* selectModel(attached, yield* requireEffort(catalog, value, current))
      case "mode":
        return yield* selectMode(attached, value)
      default:
        return yield* new ACPError.InvalidConfigOptionError({ configId })
    }
  })

  // Both selectors update the selection before switching on the server, so the echoed event diffs to no change.
  const selectModel = Effect.fnUntraced(function* (attached: Attached, model: Model.Ref) {
    yield* Ref.update(attached.selection, (selection) => ({ ...selection, model }))
    yield* input.client.session.switchModel({ sessionID: attached.id, model }).pipe(Effect.catch(ACPClient.classify))
  })

  const selectMode = Effect.fnUntraced(function* (attached: Attached, modeID: string) {
    const catalog = yield* input.catalog.get(attached.cwd)
    const mode = catalog.modes.find((item) => item.id === modeID)
    if (!mode) return yield* new ACPError.InvalidModeError({ mode: modeID })
    yield* Ref.update(attached.selection, (selection) => ({ ...selection, modeID: mode.id }))
    yield* input.client.session
      .switchAgent({ sessionID: attached.id, agent: mode.id })
      .pipe(Effect.catch(ACPClient.classify))
  })

  const getSession = Effect.fnUntraced(function* (sessionId: string, cwd: string) {
    const sessionID = yield* decodeSessionID(sessionId)
    const session = yield* input.client.session.get({ sessionID }).pipe(Effect.catch(ACPClient.classify))
    if (FSUtil.resolve(cwd) !== FSUtil.resolve(session.location.directory))
      return yield* new ACPError.SessionDirectoryMismatchError({ sessionId, cwd })
    return session
  })

  const replay = Effect.fnUntraced(function* (attached: Attached) {
    const capabilities = yield* Ref.get(input.capabilities)
    yield* Stream.paginate(undefined, (cursor: string | undefined) =>
      (cursor
        ? input.client.message.list({ sessionID: attached.id, limit: 200, cursor })
        : input.client.message.list({ sessionID: attached.id, limit: 200, order: "asc" })
      ).pipe(
        Effect.catch(ACPClient.classify),
        Effect.map((page) => [page.data, Option.fromNullishOr(page.cursor.next)] as const),
      ),
    ).pipe(Stream.runForEach((message) => replayMessage(attached, message, capabilities)))
  })

  // A message that fails to translate keeps the updates before the failure and does not stop the replay.
  const replayMessage = Effect.fnUntraced(function* (
    attached: Attached,
    message: SessionMessage.Info,
    capabilities: Capabilities,
  ) {
    const updates = ACPTranslate.replayMessage(message, attached.cwd, capabilities)
    while (true) {
      const next = yield* Effect.result(Effect.try(() => updates.next()))
      if (Result.isFailure(next))
        return yield* Effect.logWarning("ACP replay skipped the rest of a message", message.id, next.failure.cause)
      if (next.success.done) return
      yield* input.connection.sessionUpdate({ sessionId: attached.id, update: next.success.value })
    }
  })

  return {
    initialize: Effect.fnUntraced(function* (params) {
      const elicitation = params.clientCapabilities?.elicitation
      const compaction = params.clientCapabilities?.session?.compaction
      yield* Ref.set(input.capabilities, {
        childSessionUpdates: params.clientCapabilities?._meta?.[ACPTranslate.ChildSessionUpdatesCapability] === true,
        formElicitation: elicitation?.form !== undefined && elicitation.form !== null,
        compaction: compaction !== undefined && compaction !== null,
      })
      const authMethod: AuthMethod = {
        description: "Run `opencode auth login` in the terminal",
        name: "Login with opencode",
        id: AuthMethodID,
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
          _meta: { [ACPTranslate.ChildSessionUpdatesCapability]: true },
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
      // Load before creating so a catalog failure leaves no session behind. Agent and model stay unset
      // so the server resolves its defaults after plugins activate.
      yield* input.catalog.get(params.cwd)
      const created = yield* input.client.session
        .create({ location: { directory: AbsolutePath.make(params.cwd) }, ...ACPDirectories.grant(directories) })
        .pipe(Effect.catch(ACPClient.classify))
      const attached = yield* input.sessions.attach(created, params.cwd, params.mcpServers)
      return yield* currentOptions(attached).pipe(
        Effect.map((configOptions) => ({ sessionId: attached.id, configOptions })),
        Effect.onError(() => input.sessions.detach(attached.id)),
      )
    }),
    loadSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const session = yield* getSession(params.sessionId, params.cwd)
      yield* ACPDirectories.activate(input.client, session, directories)
      const attached = yield* input.sessions.attach(session, session.location.directory, params.mcpServers)
      return yield* replay(attached).pipe(
        Effect.andThen(currentOptions(attached)),
        Effect.map((configOptions) => ({ configOptions })),
        Effect.onError(() => input.sessions.detach(attached.id)),
      )
    }),
    listSessions: Effect.fnUntraced(function* (params) {
      const page = yield* input.client.session
        .list({
          ...(params.cwd ? { directory: AbsolutePath.make(params.cwd) } : {}),
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
      // A malformed ID names no session.
      const sessionID = Schema.decodeUnknownOption(Session.ID)(params.sessionId)
      if (Option.isSome(sessionID))
        yield* input.client.session.remove({ sessionID: sessionID.value }).pipe(
          Effect.catchTag("SessionNotFoundError", () => Effect.void),
          Effect.catch(ACPClient.classify),
        )
      yield* input.sessions.detach(params.sessionId)
      return {}
    }),
    resumeSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const session = yield* getSession(params.sessionId, params.cwd)
      yield* ACPDirectories.activate(input.client, session, directories)
      const attached = yield* input.sessions.attach(session, session.location.directory, params.mcpServers ?? [])
      return yield* currentOptions(attached).pipe(
        Effect.map((configOptions) => ({ configOptions })),
        Effect.onError(() => input.sessions.detach(attached.id)),
      )
    }),
    closeSession: Effect.fnUntraced(function* (params) {
      yield* input.turn.close(params.sessionId)
      yield* input.sessions.detach(params.sessionId)
      return {}
    }),
    forkSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const sessionID = yield* decodeSessionID(params.sessionId)
      const forked = yield* input.client.session.fork({ sessionID }).pipe(Effect.catch(ACPClient.classify))
      // Forks copy the source session's rules, so the request list replaces any inherited grants.
      yield* ACPDirectories.activate(input.client, forked, directories)
      const attached = yield* input.sessions.attach(forked, forked.location.directory, params.mcpServers ?? [])
      return yield* currentOptions(attached).pipe(
        Effect.map((configOptions) => ({ sessionId: attached.id, configOptions })),
        Effect.onError(() => input.sessions.detach(attached.id)),
      )
    }),
    setSessionConfigOption: Effect.fnUntraced(function* (params) {
      const attached = yield* input.sessions.require(params.sessionId)
      const value = params.value
      if (typeof value !== "string") return yield* new ACPError.InvalidConfigOptionError({ configId: params.configId })
      yield* withReload(attached, selectOption(attached, params.configId, value))
      return { configOptions: yield* currentOptions(attached) }
    }),
    setSessionMode: Effect.fnUntraced(function* (params) {
      const attached = yield* input.sessions.require(params.sessionId)
      yield* withReload(attached, selectMode(attached, params.modeId))
      return {}
    }),
    prompt: input.turn.prompt,
    cancel: input.turn.cancel,
  }
}

// The client rejects a malformed ID before sending it, so it is rejected here as the server would.
function decodeSessionID(sessionId: string) {
  return Schema.decodeUnknownEffect(Session.ID)(sessionId).pipe(
    Effect.mapError((error) => new ACPError.InvalidRequestError({ message: error.message })),
  )
}

const requireModel = Effect.fnUntraced(function* (catalog: Catalog, modelID: string, current: Model.Ref) {
  const selected = parseModelSelection(modelID, catalog.providers)
  const model = catalog.models.find(
    (item) => item.providerID === selected.model.providerID && item.id === selected.model.modelID,
  )
  if (!model) return yield* new ACPError.InvalidModelError({ providerId: selected.model.providerID, modelId: modelID })
  const selectedVariant = model.variants.find((variant) => variant.id === selected.variant)
  if (selected.variant && !selectedVariant) return yield* new ACPError.InvalidEffortError({ effort: selected.variant })
  const variant =
    selectedVariant?.id ??
    (current.providerID === model.providerID &&
    current.id === model.id &&
    (current.variant === DEFAULT_VARIANT_VALUE || model.variants.some((variant) => variant.id === current.variant))
      ? current.variant
      : undefined)
  return { providerID: model.providerID, id: model.id, variant } satisfies Model.Ref
})

const requireEffort = Effect.fnUntraced(function* (catalog: Catalog, effort: string, current: Model.Ref) {
  const model = catalog.models.find((item) => item.providerID === current.providerID && item.id === current.id)
  if (!model || (effort !== DEFAULT_VARIANT_VALUE && !model.variants.some((variant) => variant.id === effort)))
    return yield* new ACPError.InvalidEffortError({ effort })
  return { ...current, variant: Model.VariantID.make(effort) } satisfies Model.Ref
})

export * as ACPService from "./service"
