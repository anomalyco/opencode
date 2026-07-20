import {
  isSessionNotFoundError,
  type CommandInfo,
  type ModelInfo,
  type ModelRef,
  type OpenCodeClient,
  type SessionInfo,
  type SessionMessageInfo,
  type SkillInfo,
} from "@opencode-ai/client/promise"
import type {
  AgentSideConnection,
  AuthenticateRequest,
  AuthenticateResponse,
  AuthMethod,
  CancelNotification,
  CloseSessionRequest,
  CloseSessionResponse,
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
  SetSessionModelRequest,
  SetSessionModelResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { buildConfigOptions, parseModelSelection, type ConfigOptionProvider } from "./config-option"
import { promptContentToParts } from "./content"
import { replayMessages, streamTurn, type TurnControl } from "./event"
import { ACPError } from "./error"

export const AuthMethodID = "opencode-login"

type Connection = Pick<AgentSideConnection, "sessionUpdate" | "requestPermission">

type Catalog = {
  readonly providers: ConfigOptionProvider[]
  readonly models: ModelInfo[]
  readonly defaultModel: ModelRef
  readonly modes: Array<{ id: string; name: string; description?: string }>
  readonly defaultModeID: string
  readonly commands: CommandInfo[]
  readonly skills: SkillInfo[]
}

type Attached = {
  readonly id: string
  readonly cwd: string
  catalog: Catalog
  model: ModelRef
  modeID: string
}

export interface Interface {
  initialize(input: InitializeRequest): Promise<InitializeResponse>
  authenticate(input: AuthenticateRequest): Promise<AuthenticateResponse>
  newSession(input: NewSessionRequest): Promise<NewSessionResponse>
  loadSession(input: LoadSessionRequest): Promise<LoadSessionResponse>
  listSessions(input: ListSessionsRequest): Promise<ListSessionsResponse>
  resumeSession(input: ResumeSessionRequest): Promise<ResumeSessionResponse>
  closeSession(input: CloseSessionRequest): Promise<CloseSessionResponse>
  forkSession(input: ForkSessionRequest): Promise<ForkSessionResponse>
  setSessionConfigOption(input: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse>
  setSessionMode(input: SetSessionModeRequest): Promise<SetSessionModeResponse>
  setSessionModel(input: SetSessionModelRequest): Promise<SetSessionModelResponse>
  prompt(input: PromptRequest): Promise<PromptResponse>
  cancel(input: CancelNotification): Promise<void>
}

export function make(input: { readonly client: OpenCodeClient; readonly connection: Connection }): Interface {
  const sessions = new Map<string, Attached>()
  const catalogs = new Map<string, Promise<Catalog>>()
  const registeredMcp = new Map<string, Set<string>>()
  const active = new Map<string, TurnControl>()

  const catalog = (cwd: string) => {
    const cached = catalogs.get(cwd)
    if (cached) return cached
    const loaded = loadCatalog(input.client, cwd).catch((error) => {
      catalogs.delete(cwd)
      throw error
    })
    catalogs.set(cwd, loaded)
    return loaded
  }

  const requireSession = async (sessionID: string) => {
    const current = sessions.get(sessionID)
    if (current) return current
    throw new ACPError.SessionNotFoundError({ sessionId: sessionID })
  }

  const attach = async (session: SessionInfo, cwd: string, mcpServers: readonly McpServer[], replay: boolean) => {
    const currentCatalog = await catalog(cwd)
    const state: Attached = {
      id: session.id,
      cwd,
      catalog: currentCatalog,
      model: session.model ?? currentCatalog.defaultModel,
      modeID: session.agent ?? currentCatalog.defaultModeID,
    }
    sessions.set(session.id, state)
    await registerMcpServers(input.client, registeredMcp, state, mcpServers)
    await sendAvailableCommands(input.connection, state)
    if (replay) await replayMessages(input.connection, state.id, state.cwd, await messages(input.client, state.id))
    return state
  }

  const configOptions = (state: Attached) =>
    buildConfigOptions({
      providers: state.catalog.providers,
      currentModel: { providerID: state.model.providerID, modelID: state.model.id },
      currentVariant: state.model.variant,
      modes: state.catalog.modes,
      currentModeId: state.modeID,
    })

  return {
    initialize: async (params) => {
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
          sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
        },
        authMethods: [authMethod],
        agentInfo: { name: "OpenCode", version: InstallationVersion },
      }
    },
    authenticate: async (params) => {
      if (params.methodId !== AuthMethodID) throw new ACPError.UnknownAuthMethodError({ methodId: params.methodId })
      return {}
    },
    newSession: async (params) => {
      const currentCatalog = await catalog(params.cwd)
      const created = await input.client.session.create({
        location: { directory: params.cwd },
        agent: currentCatalog.defaultModeID,
        model: currentCatalog.defaultModel,
      })
      const state = await attach(created, params.cwd, params.mcpServers, false)
      return { sessionId: state.id, configOptions: configOptions(state) }
    },
    loadSession: async (params) => {
      const session = await getSession(input.client, params.sessionId)
      const state = await attach(session, session.location.directory, params.mcpServers, true)
      return { configOptions: configOptions(state) }
    },
    listSessions: async (params) => {
      const page = await input.client.session.list({
        ...(params.cwd ? { directory: params.cwd } : {}),
        order: "desc",
        limit: 100,
        ...(params.cursor ? { cursor: params.cursor } : {}),
      })
      return {
        sessions: page.data.map((session) => ({
          sessionId: session.id,
          cwd: session.location.directory,
          title: session.title,
          updatedAt: new Date(session.time.updated).toISOString(),
        })),
        ...(page.cursor.next ? { nextCursor: page.cursor.next } : {}),
      }
    },
    resumeSession: async (params) => {
      const session = await getSession(input.client, params.sessionId)
      const state = await attach(session, session.location.directory, params.mcpServers ?? [], false)
      return { configOptions: configOptions(state) }
    },
    closeSession: async (params) => {
      sessions.delete(params.sessionId)
      registeredMcp.delete(params.sessionId)
      const turn = active.get(params.sessionId)
      if (turn) {
        turn.cancelled = true
        turn.admission.abort()
      }
      await input.client.session.interrupt({ sessionID: params.sessionId }).catch(() => {})
      return {}
    },
    forkSession: async (params) => {
      const forked = await input.client.session.fork({ sessionID: params.sessionId })
      const state = await attach(forked, forked.location.directory, params.mcpServers ?? [], true)
      return { sessionId: state.id, configOptions: configOptions(state) }
    },
    setSessionConfigOption: async (params) => {
      const state = await requireSession(params.sessionId)
      if (typeof params.value !== "string") throw new ACPError.InvalidConfigOptionError({ configId: params.configId })
      if (params.configId === "model") {
        const selected = requireModel(state.catalog, params.value)
        state.model = selected
        await input.client.session.switchModel({ sessionID: state.id, model: selected })
        return { configOptions: configOptions(state) }
      }
      if (params.configId === "effort") {
        const model = state.catalog.models.find(
          (item) => item.providerID === state.model.providerID && item.id === state.model.id,
        )
        if (!model?.variants.some((variant) => variant.id === params.value))
          throw new ACPError.InvalidEffortError({ effort: params.value })
        state.model = { ...state.model, variant: params.value }
        await input.client.session.switchModel({ sessionID: state.id, model: state.model })
        return { configOptions: configOptions(state) }
      }
      if (params.configId === "mode") {
        await selectMode(input.client, state, params.value)
        return { configOptions: configOptions(state) }
      }
      throw new ACPError.InvalidConfigOptionError({ configId: params.configId })
    },
    setSessionMode: async (params) => {
      await selectMode(input.client, await requireSession(params.sessionId), params.modeId)
      return {}
    },
    setSessionModel: async (params) => {
      const state = await requireSession(params.sessionId)
      const selected = requireModel(state.catalog, params.modelId)
      state.model = selected
      await input.client.session.switchModel({ sessionID: state.id, model: selected })
      return {}
    },
    prompt: async (params) => {
      const state = await requireSession(params.sessionId)
      if (active.has(state.id)) {
        throw new ACPError.ServiceFailureError({
          safeMessage: `Session already has an active ACP prompt: ${state.id}`,
          service: "session",
        })
      }
      const messageID = SessionMessage.ID.create()
      const parts = promptContentToParts(params.prompt)
      const visible = parts.filter((part) => part.type !== "text" || (!part.synthetic && !part.ignored))
      const synthetic = parts.flatMap((part) => (part.type === "text" && part.synthetic ? [part.text] : []))
      const text = visible.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
      const files = visible.flatMap((part) => (part.type === "file" ? [{ uri: part.url, name: part.filename }] : []))
      const slash = detectSlashCommand(text)
      const command = slash ? state.catalog.commands.find((item) => item.name === slash.name) : undefined
      const skill = slash ? state.catalog.skills.find((item) => item.name === slash.name) : undefined
      const start =
        slash?.name === "compact"
          ? ({ type: "compaction", id: messageID } as const)
          : skill
            ? ({ type: "skill", id: messageID } as const)
            : ({ type: "input", id: messageID } as const)
      const control: TurnControl = { cancelled: false, admission: new AbortController() }
      active.set(state.id, control)
      const response = await streamTurn({
        client: input.client,
        connection: input.connection,
        sessionID: state.id,
        cwd: state.cwd,
        start,
        userMessageID: params.messageId,
        control,
        submit: async (signal) => {
          if (synthetic.length > 0) {
            await input.client.session.synthetic({
              sessionID: state.id,
              text: synthetic.join("\n\n"),
              description: "ACP embedded context",
              delivery: "steer",
              resume: false,
            })
          }
          if (slash?.name === "compact") return input.client.session.compact({ sessionID: state.id, id: messageID })
          if (skill) return input.client.session.skill({ sessionID: state.id, id: messageID, skill: skill.id })
          if (command)
            return input.client.session.command(
              {
                sessionID: state.id,
                id: messageID,
                command: command.name,
                arguments: slash?.args,
                files,
                delivery: "steer",
              },
              { signal },
            )
          return input.client.session.prompt(
            { sessionID: state.id, id: messageID, text, files, delivery: "steer" },
            { signal },
          )
        },
      }).finally(() => {
        if (active.get(state.id) === control) active.delete(state.id)
      })
      await sendUsageUpdate(input.client, input.connection, state).catch(() => {})
      return response
    },
    cancel: async (params) => {
      const current = active.get(params.sessionId)
      if (current) {
        current.cancelled = true
        current.admission.abort()
      }
      await input.client.session.interrupt({ sessionID: params.sessionId }).catch(() => {})
    },
  }
}

async function loadCatalog(client: OpenCodeClient, cwd: string): Promise<Catalog> {
  const location = { directory: cwd }
  const [modelResult, defaultResult, agentResult, commandResult, skillResult] = await Promise.all([
    client.model.list({ location }),
    client.model.default({ location }),
    client.agent.list({ location }),
    client.command.list({ location }),
    client.skill.list({ location }),
  ])
  const models = modelResult.data.filter((model) => model.enabled)
  const defaultModel = defaultResult.data ?? models[0]
  if (!defaultModel) throw new Error("No models are available")
  const agents = agentResult.data.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  const defaultAgent = agents.find((agent) => agent.mode === "primary") ?? agents[0]
  if (!defaultAgent) throw new Error("No primary agents are available")
  return {
    providers: providers(models),
    models,
    defaultModel: {
      providerID: defaultModel.providerID,
      id: defaultModel.id,
      variant: defaultModel.variants.find((variant) => variant.id === "default")?.id ?? defaultModel.variants[0]?.id,
    },
    modes: agents.map((agent) => ({ id: agent.id, name: agent.name, description: agent.description })),
    defaultModeID: defaultAgent.id,
    commands: commandResult.data,
    skills: skillResult.data.filter((skill) => skill.slash !== false),
  }
}

function providers(models: readonly ModelInfo[]): ConfigOptionProvider[] {
  return Array.from(new Set(models.map((model) => model.providerID)))
    .toSorted()
    .map((providerID) => ({
      id: providerID,
      name: providerID,
      models: models
        .filter((model) => model.providerID === providerID)
        .map((model) => ({ id: model.id, name: model.name, variants: model.variants.map((variant) => variant.id) })),
    }))
}

function requireModel(catalog: Catalog, modelID: string): ModelRef {
  const selected = parseModelSelection(modelID, catalog.providers)
  const model = catalog.models.find(
    (item) => item.providerID === selected.model.providerID && item.id === selected.model.modelID,
  )
  if (!model) throw new ACPError.InvalidModelError({ providerId: selected.model.providerID, modelId: modelID })
  if (selected.variant && !model.variants.some((variant) => variant.id === selected.variant))
    throw new ACPError.InvalidEffortError({ effort: selected.variant })
  return { providerID: model.providerID, id: model.id, variant: selected.variant }
}

async function selectMode(client: OpenCodeClient, state: Attached, modeID: string) {
  if (!state.catalog.modes.some((mode) => mode.id === modeID)) throw new ACPError.InvalidModeError({ mode: modeID })
  state.modeID = modeID
  await client.session.switchAgent({ sessionID: state.id, agent: modeID })
}

async function getSession(client: OpenCodeClient, sessionID: string) {
  return client.session.get({ sessionID }).catch((error) => {
    if (isSessionNotFoundError(error)) throw new ACPError.SessionNotFoundError({ sessionId: sessionID })
    throw error
  })
}

async function messages(client: OpenCodeClient, sessionID: string) {
  const result: SessionMessageInfo[] = []
  let cursor: string | undefined
  do {
    const page = cursor
      ? await client.message.list({ sessionID, limit: 200, cursor })
      : await client.message.list({ sessionID, limit: 200, order: "asc" })
    result.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)
  return result
}

async function registerMcpServers(
  client: OpenCodeClient,
  registered: Map<string, Set<string>>,
  session: Attached,
  servers: readonly McpServer[],
) {
  const current = registered.get(session.id) ?? new Set<string>()
  registered.set(session.id, current)
  await Promise.all(
    servers.flatMap((server) => {
      const config = mcpConfig(server)
      const key = `${server.name}:${stableStringify(config)}`
      if (current.has(key)) return []
      current.add(key)
      return [
        client.mcp.add({ server: server.name, location: { directory: session.cwd }, config }).catch((error) => {
          current.delete(key)
          throw error
        }),
      ]
    }),
  )
}

function mcpConfig(server: McpServer) {
  if ("type" in server) {
    return {
      type: "remote" as const,
      url: server.url,
      headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
      oauth: false as const,
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

async function sendAvailableCommands(connection: Connection, session: Attached) {
  await connection.sessionUpdate({
    sessionId: session.id,
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        ...session.catalog.commands,
        ...session.catalog.skills.filter(
          (skill) => !session.catalog.commands.some((command) => command.name === skill.name),
        ),
      ].map((command) => ({ name: command.name, description: command.description ?? "" })),
    },
  })
}

async function sendUsageUpdate(client: OpenCodeClient, connection: Connection, session: Attached) {
  const info = await client.session.get({ sessionID: session.id })
  const model = session.catalog.models.find(
    (item) => item.providerID === session.model.providerID && item.id === session.model.id,
  )
  if (!model?.limit.context) return
  await connection.sessionUpdate({
    sessionId: session.id,
    update: {
      sessionUpdate: "usage_update",
      used: info.tokens.input + info.tokens.cache.read,
      size: model.limit.context,
      cost: { amount: info.cost, currency: "USD" },
    },
  })
}

function detectSlashCommand(text: string): { readonly name: string; readonly args: string } | undefined {
  const value = text.trim()
  if (!value.startsWith("/")) return undefined
  const [name, ...rest] = value.slice(1).split(/\s+/)
  if (!name) return undefined
  return { name, args: rest.join(" ").trim() }
}

export * as ACPService from "./service"
