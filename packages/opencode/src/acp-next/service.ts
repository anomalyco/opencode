import {
  type AgentSideConnection,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type AuthMethod,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type McpServer,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from "@agentclientprotocol/sdk"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Context, Effect } from "effect"
import * as ACPNextError from "./error"
import { buildConfigOptions } from "./config-option"
import { Directory } from "./directory"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider/provider"
import type { Command } from "@/command"

export const AuthMethodID = "opencode-login"

export type Error = ACPNextError.Error

export type Interface = {
  readonly initialize: (input: InitializeRequest) => Effect.Effect<InitializeResponse, Error>
  readonly authenticate: (input: AuthenticateRequest) => Effect.Effect<AuthenticateResponse, Error>
  readonly newSession: (input: NewSessionRequest) => Effect.Effect<NewSessionResponse, Error>
  readonly loadSession: (input: LoadSessionRequest) => Effect.Effect<LoadSessionResponse, Error>
  readonly prompt: (input: PromptRequest) => Effect.Effect<PromptResponse, Error>
  readonly cancel: (input: CancelNotification) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ACPNext/Service") {}

export function make(input: { sdk: OpencodeClient; connection?: Pick<AgentSideConnection, "sessionUpdate"> }): Interface {
  const sessions = new Map<string, SessionState>()
  const directories = new Map<string, Promise<Directory.Snapshot>>()
  const registeredMcp = new Map<string, Set<string>>()

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

  const directorySnapshot = Effect.fn("ACPNext.directorySnapshot")(function* (directory: string) {
    const cached = directories.get(directory)
    if (cached) return yield* request(() => cached, "directory")

    const promise = loadDirectorySnapshot(input.sdk, directory).catch((error: unknown) => {
      directories.delete(directory)
      throw fromUnknownError(error, "directory")
    })
    directories.set(directory, promise)
    return yield* request(() => promise, "directory")
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
    const state = storeSession(sessions, {
      id: created.id,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      model: selected,
      variant,
      modeId,
    })

    yield* registerMcpServers(input.sdk, registeredMcp, params.cwd, params.mcpServers)
    yield* sendAvailableCommands(input.connection, state.id, snapshot)

    return {
      sessionId: state.id,
      configOptions: configOptions(snapshot, state),
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
    const state = storeSession(sessions, {
      id: params.sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      model,
      variant: restored.variant ?? selectVariant(snapshot, model),
      modeId: restored.modeId ?? (snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined),
    })

    yield* registerMcpServers(input.sdk, registeredMcp, params.cwd, params.mcpServers)
    yield* sendAvailableCommands(input.connection, state.id, snapshot)

    return {
      sessionId: state.id,
      configOptions: configOptions(snapshot, state),
    }
  })

  return {
    initialize,
    authenticate,
    newSession,
    loadSession,
    prompt: Effect.fn("ACPNext.prompt")(function* (_input: PromptRequest) {
      return yield* new ACPNextError.UnsupportedOperationError({ method: "session/prompt" })
    }),
    cancel: Effect.fn("ACPNext.cancel")(function* (_input: CancelNotification) {
      return yield* new ACPNextError.UnsupportedOperationError({ method: "session/cancel" })
    }),
  }
}

type SessionState = {
  readonly id: string
  readonly cwd: string
  readonly mcpServers: readonly McpServer[]
  readonly model: Directory.DefaultModel
  readonly variant?: string
  readonly modeId?: string
}

type SdkResponse<T> = {
  readonly data?: T
  readonly error?: unknown
}

type MessageInfo = {
  readonly role?: string
  readonly model?: {
    readonly providerID?: string
    readonly modelID?: string
    readonly variant?: string
  }
  readonly providerID?: string
  readonly modelID?: string
  readonly variant?: string
  readonly mode?: string
  readonly agent?: string
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

function storeSession(sessions: Map<string, SessionState>, state: SessionState) {
  sessions.set(state.id, {
    ...state,
    mcpServers: [...state.mcpServers],
  })
  return sessions.get(state.id)!
}

function configOptions(snapshot: Directory.Snapshot, session: SessionState) {
  return buildConfigOptions({
    providers: Object.values(snapshot.providers),
    currentModel: session.model,
    currentVariant: session.variant,
    modes: snapshot.availableModes,
    currentModeId: session.modeId,
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
  servers: readonly McpServer[],
) {
  const current = registered.get(directory) ?? new Set<string>()
  registered.set(directory, current)

  return Effect.all(
    Array.from(new Map(servers.map((server) => [server.name, server])).values())
      .filter((server) => !current.has(server.name))
      .map((server) =>
        request(
          () =>
            sdk.mcp.add(
              {
                directory,
                name: server.name,
                config: mcpConfig(server),
              },
              { throwOnError: true },
            ),
          "mcp",
        ).pipe(Effect.tap(() => Effect.sync(() => current.add(server.name))), Effect.ignore),
      ),
    { concurrency: "unbounded" },
  ).pipe(Effect.asVoid)
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
