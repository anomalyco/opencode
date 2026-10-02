import {
  isInvalidRequestError,
  isSessionNotFoundError,
  type ModelRef,
  type OpenCodeClient,
  type SessionMessageInfo,
} from "@opencode/client/promise"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Option, Ref, Result, Stream } from "effect"
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
import { configOptions, currentModel, DEFAULT_VARIANT_VALUE, parseModelSelection } from "./config-option"
import type { ACPConnection } from "./connection"
import { ACPDirectories } from "./directories"
import { ACPError } from "./error"
import { ACPPromise } from "./promise"
import type { ACPSessions, Attached } from "./sessions"
import { ACPTranslate } from "./translate"
import type { ACPTurn } from "./turn"

export const AuthMethodID = "opencode-login"

export type Failure = ACPError.Error | RequestError | ACPCatalog.Error

/** What the client advertised in `initialize`. */
export type Capabilities = { readonly childSessionUpdates: boolean; readonly formElicitation: boolean }

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
  const selectModel = Effect.fnUntraced(function* (attached: Attached, model: ModelRef) {
    yield* Ref.update(attached.selection, (selection) => ({ ...selection, model }))
    yield* ACPPromise.promise(() => input.client.session.switchModel({ sessionID: attached.id, model }))
  })

  const selectMode = Effect.fnUntraced(function* (attached: Attached, modeID: string) {
    const catalog = yield* input.catalog.get(attached.cwd)
    if (!catalog.modes.some((mode) => mode.id === modeID)) return yield* new ACPError.InvalidModeError({ mode: modeID })
    yield* Ref.update(attached.selection, (selection) => ({ ...selection, modeID }))
    yield* ACPPromise.promise(() => input.client.session.switchAgent({ sessionID: attached.id, agent: modeID }))
  })

  const getSession = Effect.fnUntraced(function* (sessionID: string, cwd: string) {
    const session = yield* ACPPromise.promise(() => input.client.session.get({ sessionID }))
    if (FSUtil.resolve(cwd) !== FSUtil.resolve(session.location.directory))
      return yield* new ACPError.SessionDirectoryMismatchError({ sessionId: sessionID, cwd })
    return session
  })

  const replay = (attached: Attached) =>
    Stream.paginate(undefined, (cursor: string | undefined) =>
      ACPPromise.promise(() =>
        cursor
          ? input.client.message.list({ sessionID: attached.id, limit: 200, cursor })
          : input.client.message.list({ sessionID: attached.id, limit: 200, order: "asc" }),
      ).pipe(Effect.map((page) => [page.data, Option.fromNullishOr(page.cursor.next)] as const)),
    ).pipe(Stream.runForEach((message) => replayMessage(attached, message)))

  // A message that fails to translate keeps the updates before the failure and does not stop the replay.
  const replayMessage = Effect.fnUntraced(function* (attached: Attached, message: SessionMessageInfo) {
    const updates = ACPTranslate.replayMessage(message, attached.cwd)
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
      yield* Ref.set(input.capabilities, {
        childSessionUpdates: params.clientCapabilities?._meta?.[ACPTranslate.ChildSessionUpdatesCapability] === true,
        formElicitation: elicitation?.form !== undefined && elicitation.form !== null,
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
      const created = yield* ACPPromise.promise(() =>
        input.client.session.create({
          location: { directory: params.cwd },
          ...ACPDirectories.grant(directories),
        }),
      )
      const attached = yield* input.sessions.attach(created, params.cwd, params.mcpServers)
      return { sessionId: attached.id, configOptions: yield* currentOptions(attached) }
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
      const page = yield* ACPPromise.promise(() =>
        input.client.session.list({
          ...(params.cwd ? { directory: params.cwd } : {}),
          order: "desc",
          limit: 100,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        }),
      )
      return {
        sessions: page.data.map((session) => {
          const additionalDirectories = ACPDirectories.list(session)
          return {
            sessionId: session.id,
            cwd: session.location.directory,
            ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
            title: withTimestampedFallback(session),
            updatedAt: new Date(session.time.updated).toISOString(),
          }
        }),
        ...(page.cursor.next ? { nextCursor: page.cursor.next } : {}),
      }
    }),
    deleteSession: Effect.fnUntraced(function* (params) {
      // A malformed ID fails the server's path decode, and the session ID is the only path param.
      yield* ACPPromise.promise(() =>
        input.client.session.remove({ sessionID: params.sessionId }).catch((error) => {
          if (isSessionNotFoundError(error) || (isInvalidRequestError(error) && error.kind === "Params")) return
          throw error
        }),
      )
      yield* input.sessions.detach(params.sessionId)
      return {}
    }),
    resumeSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const session = yield* getSession(params.sessionId, params.cwd)
      yield* ACPDirectories.activate(input.client, session, directories)
      const attached = yield* input.sessions.attach(session, session.location.directory, params.mcpServers ?? [])
      return { configOptions: yield* currentOptions(attached) }
    }),
    closeSession: Effect.fnUntraced(function* (params) {
      yield* input.turn.close(params.sessionId)
      yield* input.sessions.detach(params.sessionId)
      return {}
    }),
    forkSession: Effect.fnUntraced(function* (params) {
      const directories = yield* ACPDirectories.parse(params.cwd, params.additionalDirectories)
      const forked = yield* ACPPromise.promise(() => input.client.session.fork({ sessionID: params.sessionId }))
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

const requireModel = Effect.fnUntraced(function* (catalog: Catalog, modelID: string, current: ModelRef) {
  const selected = parseModelSelection(modelID, catalog.providers)
  const model = catalog.models.find(
    (item) => item.providerID === selected.model.providerID && item.id === selected.model.modelID,
  )
  if (!model) return yield* new ACPError.InvalidModelError({ providerId: selected.model.providerID, modelId: modelID })
  if (selected.variant && !model.variants.some((variant) => variant.id === selected.variant))
    return yield* new ACPError.InvalidEffortError({ effort: selected.variant })
  const variant =
    selected.variant ??
    (current.providerID === model.providerID &&
    current.id === model.id &&
    (current.variant === DEFAULT_VARIANT_VALUE || model.variants.some((variant) => variant.id === current.variant))
      ? current.variant
      : undefined)
  return { providerID: model.providerID, id: model.id, variant } satisfies ModelRef
})

const requireEffort = Effect.fnUntraced(function* (catalog: Catalog, effort: string, current: ModelRef) {
  const model = catalog.models.find((item) => item.providerID === current.providerID && item.id === current.id)
  if (!model || (effort !== DEFAULT_VARIANT_VALUE && !model.variants.some((variant) => variant.id === effort)))
    return yield* new ACPError.InvalidEffortError({ effort })
  return { ...current, variant: effort } satisfies ModelRef
})

export * as ACPService from "./service"
