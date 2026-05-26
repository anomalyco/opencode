import {
  type AgentSideConnection,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type AuthMethod,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type McpServer,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionInfo,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModelRequest,
  type SetSessionModelResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as Log from "@opencode-ai/core/util/log"
import type { Message, OpencodeClient, SessionMessageResponse } from "@opencode-ai/sdk/v2"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import * as ACPNextError from "./error"
import { buildConfigOptions, parseModelSelection } from "./config-option"
import { Directory } from "./directory"
import { ACPNextEvent } from "./event"
import { ACPNextSession } from "./session"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider/provider"
import type { Command } from "@/command"

export const AuthMethodID = "opencode-login"
const log = Log.create({ service: "acp-next-service" })

export type Error = ACPNextError.Error

export type Interface = {
  readonly initialize: (input: InitializeRequest) => Effect.Effect<InitializeResponse, Error>
  readonly authenticate: (input: AuthenticateRequest) => Effect.Effect<AuthenticateResponse, Error>
  readonly newSession: (input: NewSessionRequest) => Effect.Effect<NewSessionResponse, Error>
  readonly loadSession: (input: LoadSessionRequest) => Effect.Effect<LoadSessionResponse, Error>
  readonly listSessions: (input: ListSessionsRequest) => Effect.Effect<ListSessionsResponse, Error>
  readonly resumeSession: (input: ResumeSessionRequest) => Effect.Effect<ResumeSessionResponse, Error>
  readonly closeSession: (input: CloseSessionRequest) => Effect.Effect<CloseSessionResponse, Error>
  readonly forkSession: (input: ForkSessionRequest) => Effect.Effect<ForkSessionResponse, Error>
  readonly setSessionConfigOption: (
    input: SetSessionConfigOptionRequest,
  ) => Effect.Effect<SetSessionConfigOptionResponse, Error>
  readonly setSessionMode: (input: SetSessionModeRequest) => Effect.Effect<SetSessionModeResponse, Error>
  readonly setSessionModel: (input: SetSessionModelRequest) => Effect.Effect<SetSessionModelResponse, Error>
  readonly prompt: (input: PromptRequest) => Effect.Effect<PromptResponse, Error>
  readonly cancel: (input: CancelNotification) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ACPNext/Service") {}

export function make(input: {
  sdk: OpencodeClient
  connection?: Pick<AgentSideConnection, "sessionUpdate">
  directory?: Directory.Interface
  session?: ACPNextSession.Interface
  eventSubscription?: (subscription: ACPNextEvent.Subscription) => void
}): Interface {
  const session = input.session ?? makeSessionService()
  const directoryService = input.directory ?? makeDirectoryService(input.sdk)
  const registeredMcp = new Map<string, Set<string>>()
  const events = input.connection
    ? ACPNextEvent.start({ sdk: input.sdk, connection: input.connection, session })
    : undefined
  if (events) input.eventSubscription?.(events)

  const initialize = Effect.fn("ACPNext.initialize")(function* (params: InitializeRequest) {
    const authMethod: AuthMethod = {
      description: "Run `opencode auth login` in the terminal",
      name: "Login with opencode",
      id: AuthMethodID,
    }

    if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
      authMethod._meta = {
        "terminal-auth": {
          command: "opencode",
          args: ["auth", "login"],
          label: "OpenCode Login",
        },
      }
    }

    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
        sessionCapabilities: {
          close: {},
          fork: {},
          list: {},
          resume: {},
        },
      },
      authMethods: [authMethod],
      agentInfo: {
        name: "OpenCode",
        version: InstallationVersion,
      },
    }
  })

  const authenticate = Effect.fn("ACPNext.authenticate")(function* (params: AuthenticateRequest) {
    if (params.methodId !== AuthMethodID) {
      return yield* new ACPNextError.UnknownAuthMethodError({ methodId: params.methodId })
    }
    return {}
  })

  const directorySnapshot = Effect.fn("ACPNext.directorySnapshot")(function* (cwd: string) {
    return yield* directoryService.get(cwd)
  })

  const newSession = Effect.fn("ACPNext.newSession")(function* (params: NewSessionRequest) {
    const snapshot = yield* directorySnapshot(params.cwd)
    const selected = selectDefaultModel(snapshot)
    const variant = selectVariant(snapshot, selected)
    const modeId = snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined
    const created = yield* request(
      () =>
        input.sdk.session.create(
          {
            directory: params.cwd,
            ...(modeId ? { agent: modeId } : {}),
            model: {
              providerID: selected.providerID,
              id: selected.modelID,
              ...(variant ? { variant } : {}),
            },
          },
          { throwOnError: true },
        ),
      "session",
    )
    const state = yield* session.create({
      id: created.id,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      model: selected,
      variant,
      modeId,
    })

    yield* registerMcpServers(input.sdk, registeredMcp, params.cwd, state.id, params.mcpServers)
    yield* sendAvailableCommands(input.connection, state.id, snapshot)

    return {
      sessionId: state.id,
      configOptions: configOptions(snapshot, {
        model: state.model ?? selected,
        variant: state.variant,
        modeId: state.modeId,
      }),
    }
  })

  const loadSession = Effect.fn("ACPNext.loadSession")(function* (params: LoadSessionRequest) {
    const snapshot = yield* directorySnapshot(params.cwd)
    yield* request(
      () => input.sdk.session.get({ directory: params.cwd, sessionID: params.sessionId }, { throwOnError: true }),
      "session",
    )
    const messages = yield* request(
      () =>
        input.sdk.session.messages(
          { directory: params.cwd, sessionID: params.sessionId, limit: 100 },
          { throwOnError: true },
        ),
      "session",
    )
    const restored = restoreFromMessages(messages.map((item) => item.info))
    const model = restored.model ?? selectDefaultModel(snapshot)
    const state = yield* session.load({
      id: params.sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      model,
      variant: restored.variant ?? selectVariant(snapshot, model),
      modeId: restored.modeId ?? (snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined),
    })

    yield* registerMcpServers(input.sdk, registeredMcp, params.cwd, state.id, params.mcpServers)
    yield* sendAvailableCommands(input.connection, state.id, snapshot)
    yield* replayMessages(events, messages)

    return {
      configOptions: configOptions(snapshot, {
        model: state.model ?? model,
        variant: state.variant,
        modeId: state.modeId,
      }),
    }
  })

  const listSessions = Effect.fn("ACPNext.listSessions")(function* (params: ListSessionsRequest) {
    const cursor = params.cursor ? Number(params.cursor) : undefined
    const limit = 100
    const sessions = yield* request(
      () =>
        input.sdk.session.list(
          {
            ...(params.cwd ? { directory: params.cwd } : {}),
            roots: true,
          },
          { throwOnError: true },
        ),
      "session",
    )
    const sorted = sessions.toSorted((a, b) => b.time.updated - a.time.updated)
    const filtered =
      cursor === undefined || !Number.isFinite(cursor) ? sorted : sorted.filter((item) => item.time.updated < cursor)
    const page = filtered.slice(0, limit)
    const last = page.at(-1)
    return {
      sessions: page.map(
        (item): SessionInfo => ({
          sessionId: item.id,
          cwd: item.directory,
          title: item.title,
          updatedAt: new Date(item.time.updated).toISOString(),
        }),
      ),
      ...(filtered.length > limit && last ? { nextCursor: String(last.time.updated) } : {}),
    }
  })

  const resumeSession = Effect.fn("ACPNext.resumeSession")(function* (params: ResumeSessionRequest) {
    const snapshot = yield* directorySnapshot(params.cwd)
    yield* request(
      () => input.sdk.session.get({ directory: params.cwd, sessionID: params.sessionId }, { throwOnError: true }),
      "session",
    )
    const messages = yield* request(
      () =>
        input.sdk.session.messages(
          { directory: params.cwd, sessionID: params.sessionId, limit: 20 },
          { throwOnError: true },
        ),
      "session",
    )
    const restored = restoreFromMessages(messages.map((item) => item.info))
    const model = restored.model ?? selectDefaultModel(snapshot)
    const state = yield* session.load({
      id: params.sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers ?? [],
      model,
      variant: restored.variant ?? selectVariant(snapshot, model),
      modeId: restored.modeId ?? (snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined),
    })

    yield* registerMcpServers(input.sdk, registeredMcp, params.cwd, state.id, params.mcpServers ?? [])
    yield* sendAvailableCommands(input.connection, state.id, snapshot)
    yield* replayMessages(events, messages)

    return {
      configOptions: configOptions(snapshot, {
        model: state.model ?? model,
        variant: state.variant,
        modeId: state.modeId,
      }),
    }
  })

  const closeSession = Effect.fn("ACPNext.closeSession")(function* (params: CloseSessionRequest) {
    const removed = yield* session.remove(params.sessionId)
    registeredMcp.delete(params.sessionId)
    if (!removed) return {}

    yield* request(
      () => input.sdk.session.abort({ directory: removed.cwd, sessionID: params.sessionId }, { throwOnError: true }),
      "session",
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          log.error("failed to abort session while closing ACP session", { error, sessionID: params.sessionId })
        }),
      ),
    )
    return {}
  })

  const forkSession = Effect.fn("ACPNext.forkSession")(function* (params: ForkSessionRequest) {
    const snapshot = yield* directorySnapshot(params.cwd)
    const forked = yield* request(
      () =>
        input.sdk.session.fork(
          {
            directory: params.cwd,
            sessionID: params.sessionId,
          },
          { throwOnError: true },
        ),
      "session",
    )
    const messages = yield* request(
      () =>
        input.sdk.session.messages({ directory: params.cwd, sessionID: forked.id, limit: 20 }, { throwOnError: true }),
      "session",
    )
    const restored = restoreFromMessages(messages.map((item) => item.info))
    const model = restored.model ?? selectDefaultModel(snapshot)
    const state = yield* session.load({
      id: forked.id,
      cwd: params.cwd,
      mcpServers: params.mcpServers ?? [],
      model,
      variant: restored.variant ?? selectVariant(snapshot, model),
      modeId: restored.modeId ?? (snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined),
    })

    yield* registerMcpServers(input.sdk, registeredMcp, params.cwd, state.id, params.mcpServers ?? [])
    yield* sendAvailableCommands(input.connection, state.id, snapshot)
    yield* replayMessages(events, messages)

    return {
      sessionId: state.id,
      configOptions: configOptions(snapshot, {
        model: state.model ?? model,
        variant: state.variant,
        modeId: state.modeId,
      }),
    }
  })

  const setSessionConfigOption = Effect.fn("ACPNext.setSessionConfigOption")(function* (
    params: SetSessionConfigOptionRequest,
  ) {
    const current = yield* session.get(params.sessionId)
    const snapshot = yield* directorySnapshot(current.cwd)
    if (typeof params.value !== "string") {
      return yield* new ACPNextError.InvalidConfigOptionError({ configId: params.configId })
    }

    if (params.configId === "model") {
      const selected = yield* parseSelectedModel(snapshot, params.value)
      const variant = selected.variant ?? selectVariant(snapshot, selected.model)
      const state = yield* session
        .setVariant(params.sessionId, Directory.variants(snapshot, selected.model) ? variant : undefined)
        .pipe(Effect.andThen(session.setModel(params.sessionId, selected.model)))
      return {
        configOptions: configOptions(snapshot, {
          model: state.model ?? selected.model,
          variant: state.variant,
          modeId: state.modeId,
        }),
      }
    }

    if (params.configId === "effort") {
      const model = current.model ?? selectDefaultModel(snapshot)
      const variants = Directory.variants(snapshot, model)
      if (!variants || !Object.keys(variants).includes(params.value)) {
        return yield* new ACPNextError.InvalidEffortError({ effort: params.value })
      }
      const state = yield* session.setVariant(params.sessionId, params.value)
      return {
        configOptions: configOptions(snapshot, {
          model: state.model ?? model,
          variant: state.variant,
          modeId: state.modeId,
        }),
      }
    }

    if (params.configId === "mode") {
      if (!snapshot.availableModes.some((mode) => mode.id === params.value)) {
        return yield* new ACPNextError.InvalidModeError({ mode: params.value })
      }
      const state = yield* session.setMode(params.sessionId, params.value)
      return {
        configOptions: configOptions(snapshot, {
          model: state.model ?? selectDefaultModel(snapshot),
          variant: state.variant,
          modeId: state.modeId,
        }),
      }
    }

    return yield* new ACPNextError.InvalidConfigOptionError({ configId: params.configId })
  })

  const setSessionMode = Effect.fn("ACPNext.setSessionMode")(function* (params: SetSessionModeRequest) {
    const current = yield* session.get(params.sessionId)
    const snapshot = yield* directorySnapshot(current.cwd)
    if (!snapshot.availableModes.some((mode) => mode.id === params.modeId)) {
      return yield* new ACPNextError.InvalidModeError({ mode: params.modeId })
    }
    yield* session.setMode(params.sessionId, params.modeId)
    return {}
  })

  const setSessionModel = Effect.fn("ACPNext.setSessionModel")(function* (params: SetSessionModelRequest) {
    const current = yield* session.get(params.sessionId)
    const snapshot = yield* directorySnapshot(current.cwd)
    const selected = yield* parseSelectedModel(snapshot, params.modelId)
    yield* session
      .setVariant(
        params.sessionId,
        Directory.variants(snapshot, selected.model)
          ? (selected.variant ?? selectVariant(snapshot, selected.model))
          : undefined,
      )
      .pipe(Effect.andThen(session.setModel(params.sessionId, selected.model)))
    return {}
  })

  return {
    initialize,
    authenticate,
    newSession,
    loadSession,
    listSessions,
    resumeSession,
    closeSession,
    forkSession,
    setSessionConfigOption,
    setSessionMode,
    setSessionModel,
    prompt: Effect.fn("ACPNext.prompt")(function* (_input: PromptRequest) {
      return yield* new ACPNextError.UnsupportedOperationError({ method: "session/prompt" })
    }),
    cancel: Effect.fn("ACPNext.cancel")(function* (_input: CancelNotification) {
      return yield* new ACPNextError.UnsupportedOperationError({ method: "session/cancel" })
    }),
  }
}

function makeSessionService() {
  return ManagedRuntime.make(ACPNextSession.defaultLayer).runSync(
    ACPNextSession.Service.use((service) => Effect.succeed(service)),
  )
}

function makeDirectoryService(sdk: OpencodeClient) {
  return ManagedRuntime.make(
    Directory.layer.pipe(
      Layer.provide(
        Layer.succeed(
          Directory.Loader,
          Directory.Loader.of({
            load: (directory) => request(() => loadDirectorySnapshot(sdk, directory), "directory"),
          }),
        ),
      ),
    ),
  ).runSync(Directory.Service.use((service) => Effect.succeed(service)))
}

function replayMessages(subscription: ACPNextEvent.Subscription | undefined, messages: SessionMessageResponse[]) {
  if (!subscription) return Effect.void
  return Effect.promise(async () => {
    for (const message of messages) {
      await subscription.replayMessage(message).catch((error: unknown) => {
        log.error("failed to replay ACP message", { error, messageID: message.info.id })
      })
    }
  })
}

type ConfigState = {
  readonly model: Directory.DefaultModel
  readonly variant?: string
  readonly modeId?: string
}

type SdkResponse<T> = {
  readonly data?: T
  readonly error?: unknown
}

type MessageInfo = {
  readonly role?: Message["role"]
  readonly model?: Extract<Message, { role: "user" }>["model"]
  readonly providerID?: Extract<Message, { role: "assistant" }>["providerID"]
  readonly modelID?: Extract<Message, { role: "assistant" }>["modelID"]
  readonly variant?: Extract<Message, { role: "assistant" }>["variant"]
  readonly mode?: Extract<Message, { role: "assistant" }>["mode"]
  readonly agent?: Message["agent"]
}

function request<T>(fn: () => Promise<T | SdkResponse<T>>, service?: string) {
  return Effect.tryPromise({
    try: async () => {
      const result = await fn()
      if (isSdkResponse<T>(result)) {
        if (result.error) throw result.error
        if (result.data !== undefined) return result.data
      }
      return result as T
    },
    catch: (error) => fromUnknownError(error, service),
  })
}

async function loadDirectorySnapshot(sdk: OpencodeClient, directory: string) {
  const [providersResponse, agentsResponse, commandsResponse, skillsResponse] = await Promise.all([
    sdk.config.providers({ directory }, { throwOnError: true }),
    sdk.app.agents({ directory }, { throwOnError: true }),
    sdk.command.list({ directory }, { throwOnError: true }),
    sdk.app.skills({ directory }, { throwOnError: true }),
  ])
  const providersData = providersResponse.data!
  const agents = agentsResponse.data!
  const commandsData = commandsResponse.data!
  const skills = skillsResponse.data!
  const providers = Object.fromEntries(providersData.providers.map((provider) => [provider.id, provider])) as Record<
    ProviderID,
    Provider.Info
  >
  const defaultModel = await defaultModelFromSdk(sdk, directory, providers)
  const modes = agents
    .filter((agent) => agent.mode !== "subagent" && agent.hidden !== true)
    .map((agent) => ({
      id: agent.name,
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
    }))
  const commands = [
    ...commandsData,
    ...skills
      .filter((skill) => !commandsData.some((command) => command.name === skill.name))
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: "skill" as const,
        template: skill.content,
        hints: [],
      })),
  ] as Command.Info[]

  return Directory.build({
    directory,
    providers,
    modes,
    defaultModeID: agents.find((agent) => agent.mode === "primary" && agent.hidden !== true)?.name ?? "build",
    commands: commands.toSorted((a, b) => a.name.localeCompare(b.name)),
    ...(defaultModel ? { defaultModel } : {}),
  })
}

async function defaultModelFromSdk(
  sdk: OpencodeClient,
  directory: string,
  providers: Record<ProviderID, Provider.Info>,
): Promise<Directory.DefaultModel | undefined> {
  const configured = await sdk.config
    .get({ directory }, { throwOnError: true })
    .then((response) => (response.data?.model ? Provider.parseModel(response.data.model) : undefined))
    .catch(() => undefined)
  if (configured && providers[configured.providerID]?.models[configured.modelID]) return configured

  const lastUsed = await lastUsedModel(sdk, directory, providers)
  if (lastUsed) return lastUsed

  const opencodeProvider = providers[ProviderID.make("opencode")]
  const opencodeModel = opencodeProvider ? Provider.sort(Object.values(opencodeProvider.models))[0] : undefined
  if (opencodeProvider && opencodeModel) return { providerID: opencodeProvider.id, modelID: opencodeModel.id }

  const best = Provider.sort(Object.values(providers).flatMap((provider) => Object.values(provider.models)))[0]
  if (best) return { providerID: best.providerID, modelID: best.id }
  if (configured) return configured
}

async function lastUsedModel(
  sdk: OpencodeClient,
  directory: string,
  providers: Record<ProviderID, Provider.Info>,
): Promise<Directory.DefaultModel | undefined> {
  const session = await sdk.session
    .list({ directory, roots: true, limit: 1 }, { throwOnError: true })
    .then((response) => response.data?.[0])
    .catch(() => undefined)
  if (!session) return

  const lastUser = await sdk.session
    .messages({ directory, sessionID: session.id, limit: 20 }, { throwOnError: true })
    .then((response) => response.data?.findLast((message) => message.info.role === "user")?.info)
    .catch(() => undefined)
  if (lastUser?.role !== "user") return
  if (!providers[ProviderID.make(lastUser.model.providerID)]?.models[ModelID.make(lastUser.model.modelID)]) return

  return {
    providerID: ProviderID.make(lastUser.model.providerID),
    modelID: ModelID.make(lastUser.model.modelID),
  }
}

function selectDefaultModel(snapshot: Directory.Snapshot) {
  if (snapshot.defaultModel) return snapshot.defaultModel
  const model = snapshot.modelOptions[0]
  if (model) return { providerID: model.providerID, modelID: model.modelID }
  return { providerID: "unknown" as ProviderID, modelID: "unknown" as ModelID }
}

function selectVariant(snapshot: Directory.Snapshot, model: Directory.DefaultModel) {
  const variants = Directory.variants(snapshot, model)
  if (!variants) return
  if (variants.default) return "default"
  return Object.keys(variants)[0]
}

function configOptions(snapshot: Directory.Snapshot, session: ConfigState) {
  return buildConfigOptions({
    providers: Object.values(snapshot.providers),
    currentModel: session.model,
    currentVariant: session.variant,
    modes: snapshot.availableModes,
    currentModeId: session.modeId,
  })
}

function parseSelectedModel(snapshot: Directory.Snapshot, modelId: string) {
  const selected = parseModelSelection(modelId, Object.values(snapshot.providers))
  const provider = snapshot.providers[ProviderID.make(selected.model.providerID)]
  const model = provider?.models[ModelID.make(selected.model.modelID)]
  if (!model) {
    return Effect.fail(
      new ACPNextError.InvalidModelError({
        providerId: selected.model.providerID,
        modelId,
      }),
    )
  }
  if (selected.variant && !model.variants?.[selected.variant]) {
    return Effect.fail(new ACPNextError.InvalidEffortError({ effort: selected.variant }))
  }
  return Effect.succeed({
    model: {
      providerID: provider.id,
      modelID: model.id,
    },
    variant: selected.variant,
  })
}

function sendAvailableCommands(
  connection: Pick<AgentSideConnection, "sessionUpdate"> | undefined,
  sessionId: string,
  snapshot: Directory.Snapshot,
) {
  if (!connection) return Effect.void
  return Effect.sync(() => {
    setTimeout(() => {
      void connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: snapshot.availableCommands.map((command) => ({
            name: command.name,
            description: command.description ?? "",
          })),
        },
      })
    }, 0)
  })
}

function registerMcpServers(
  sdk: OpencodeClient,
  registered: Map<string, Set<string>>,
  directory: string,
  sessionId: string,
  servers: readonly McpServer[],
) {
  const current = registered.get(sessionId) ?? new Set<string>()
  registered.set(sessionId, current)
  const pending = new Set<string>()

  return Effect.all(
    servers
      .map((server) => ({ server, config: mcpConfig(server) }))
      .filter((entry) => {
        const key = mcpRegistrationKey(entry.server.name, entry.config)
        if (current.has(key) || pending.has(key)) return false
        pending.add(key)
        return true
      })
      .map((entry) =>
        request(
          () =>
            sdk.mcp.add(
              {
                directory,
                name: entry.server.name,
                config: entry.config,
              },
              { throwOnError: true },
            ),
          "mcp",
        ).pipe(
          Effect.tap(() => Effect.sync(() => current.add(mcpRegistrationKey(entry.server.name, entry.config)))),
          Effect.ignore,
        ),
      ),
    { concurrency: "unbounded" },
  ).pipe(Effect.asVoid)
}

function mcpRegistrationKey(name: string, config: ReturnType<typeof mcpConfig>) {
  return `${name}:${stableStringify(config)}`
}

function mcpConfig(server: McpServer) {
  if ("type" in server) {
    return {
      type: "remote" as const,
      url: server.url,
      headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
    }
  }
  return {
    type: "local" as const,
    command: [server.command, ...server.args],
    environment: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.entries(value)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}

function restoreFromMessages(messages: readonly MessageInfo[]) {
  const user = messages.findLast(
    (message) => message.role === "user" && message.model?.providerID && message.model.modelID,
  )
  if (user?.model?.providerID && user.model.modelID) {
    return {
      model: { providerID: user.model.providerID as ProviderID, modelID: user.model.modelID as ModelID },
      variant: user.model.variant,
      modeId: user.agent,
    }
  }

  const assistant = messages.findLast((message) => message.providerID && message.modelID)
  if (assistant?.providerID && assistant.modelID) {
    return {
      model: { providerID: assistant.providerID as ProviderID, modelID: assistant.modelID as ModelID },
      variant: assistant.variant,
      modeId: assistant.mode ?? assistant.agent,
    }
  }

  return {}
}

function isSdkResponse<T>(value: T | SdkResponse<T>): value is SdkResponse<T> {
  return typeof value === "object" && value !== null && ("data" in value || "error" in value)
}

function fromUnknownError(error: unknown, service?: string): Error {
  if (isACPNextError(error)) return error
  if (isAuthRequired(error)) {
    return new ACPNextError.AuthRequiredError({ providerId: findProviderID(error) })
  }
  return new ACPNextError.ServiceFailureError({ safeMessage: "OpenCode service failure", service })
}

function isACPNextError(error: unknown): error is Error {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    error._tag.startsWith("ACPNext")
  )
}

function isAuthRequired(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  if (value instanceof Error && (value.name === "ProviderAuthError" || value.name === "LoadAPIKeyError")) return true
  if (
    value instanceof Error &&
    (value.message.includes("ProviderAuthError") || value.message.includes("LoadAPIKeyError"))
  ) {
    return true
  }
  if ("name" in value && (value.name === "ProviderAuthError" || value.name === "LoadAPIKeyError")) return true
  if ("_tag" in value && (value._tag === "ProviderAuthError" || value._tag === "LoadAPIKeyError")) return true
  if ("error" in value && isAuthRequired(value.error)) return true
  if ("data" in value && isAuthRequired(value.data)) return true
  return false
}

function findProviderID(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return
  if ("providerID" in value && typeof value.providerID === "string") return value.providerID
  if ("providerId" in value && typeof value.providerId === "string") return value.providerId
  if ("data" in value) return findProviderID(value.data)
  if ("error" in value) return findProviderID(value.error)
}
