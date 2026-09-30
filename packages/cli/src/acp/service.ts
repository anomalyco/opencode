import {
  isSessionNotFoundError,
  type CommandInfo,
  type ModelInfo,
  type ModelRef,
  type OpenCodeClient,
  type SessionInfo,
  type SessionMessageInfo,
} from "@opencode/client/promise"
import { FSUtil } from "@opencode/util/fs-util"
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
import { SessionMessage } from "@opencode/schema/session-message"
import {
  buildConfigOptions,
  DEFAULT_VARIANT_VALUE,
  parseModelSelection,
  type ConfigOptionProvider,
} from "./config-option"
import type { ACPConnection } from "./connection"
import { promptContentToParts } from "./content"
import {
  ChildSessionUpdateMethod,
  ChildSessionUpdatesCapability,
  replayMessages,
  streamTurn,
  type ChildSessionUpdate,
  type TurnControl,
  type TurnStart,
} from "./event"
import { ACPError } from "./error"

export const AuthMethodID = "opencode-login"

type Catalog = {
  readonly providers: ConfigOptionProvider[]
  readonly models: ModelInfo[]
  readonly defaultModel: ModelRef
  readonly modes: Array<{ id: string; name: string; description?: string }>
  readonly defaultModeID: string
  readonly commands: CommandInfo[]
}

// Model and mode are unset while the session follows the server defaults.
type Attached = {
  readonly id: string
  readonly cwd: string
  readonly abort: AbortController
  catalog: Catalog
  model?: ModelRef
  modeID?: string
}

// Location plugins fill the catalog after the first reads, so these events refresh it.
const catalogEvents = new Set([
  "provider.updated",
  "model.updated",
  "integration.updated",
  "credential.switched",
  "agent.updated",
  "command.updated",
])

type PreparedPrompt = {
  readonly start: TurnStart
  readonly text: string
  readonly files: Array<{ readonly uri: string; readonly name?: string }>
  readonly synthetic: ReadonlyArray<string>
  readonly slash?: { readonly name: string; readonly args: string }
  readonly command?: CommandInfo
}

export interface Interface {
  initialize(input: InitializeRequest): Promise<InitializeResponse>
  authenticate(input: AuthenticateRequest): Promise<AuthenticateResponse>
  newSession(input: NewSessionRequest): Promise<NewSessionResponse>
  loadSession(input: LoadSessionRequest): Promise<LoadSessionResponse>
  listSessions(input: ListSessionsRequest): Promise<ListSessionsResponse>
  deleteSession(input: DeleteSessionRequest): Promise<DeleteSessionResponse>
  resumeSession(input: ResumeSessionRequest): Promise<ResumeSessionResponse>
  closeSession(input: CloseSessionRequest): Promise<CloseSessionResponse>
  forkSession(input: ForkSessionRequest): Promise<ForkSessionResponse>
  setSessionConfigOption(input: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse>
  setSessionMode(input: SetSessionModeRequest): Promise<SetSessionModeResponse>
  prompt(input: PromptRequest, signal?: AbortSignal): Promise<PromptResponse>
  cancel(input: CancelNotification): Promise<void>
}

export function make(input: {
  readonly client: OpenCodeClient
  readonly connection: ACPConnection.Connection
}): Interface {
  const sessions = new Map<string, Attached>()
  const catalogs = new Map<string, Promise<Catalog>>()
  const registeredMcp = new Map<string, Set<string>>()
  const active = new Map<string, { readonly control: TurnControl; readonly turn: Promise<PromptResponse> }>()
  const capabilities = { writeTextFile: false, childSessionUpdates: false }

  const refreshing = new Map<string, Promise<void>>()
  const stale = new Set<string>()
  let watching: Promise<void> | undefined

  const catalog = (cwd: string) => {
    const cached = catalogs.get(cwd)
    if (cached) return cached
    // Subscribe before the first read so no update between the read and the subscription is lost.
    const loaded = watch()
      .then(() => loadCatalog(input.client, cwd))
      .catch((error) => {
        catalogs.delete(cwd)
        throw error
      })
    catalogs.set(cwd, loaded)
    return loaded
  }

  const watch = () => {
    if (watching) return watching
    const ready = Promise.withResolvers<void>()
    watching = ready.promise
    void (async () => {
      for await (const event of input.client.event.subscribe({ signal: input.connection.signal })) {
        ready.resolve()
        if (!catalogEvents.has(event.type)) continue
        const directory = event.location?.directory
        for (const cwd of catalogs.keys()) {
          if (directory === undefined || FSUtil.resolve(directory) === FSUtil.resolve(cwd)) refresh(cwd)
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        // Catalogs still load without live updates; the next load subscribes again.
        ready.resolve()
        watching = undefined
      })
    return watching
  }

  // Coalesces bursts of updates into at most one reload in flight plus one queued per cwd.
  const refresh = (cwd: string) => {
    const running = refreshing.get(cwd)
    if (running) {
      stale.add(cwd)
      return running
    }
    const run = (async () => {
      do {
        stale.delete(cwd)
        const previous = await catalogs.get(cwd)?.catch(() => undefined)
        if (!previous) return
        const next = await loadCatalog(input.client, cwd).catch(() => undefined)
        if (!next) return
        catalogs.set(cwd, Promise.resolve(next))
        await publish(cwd, next)
      } while (stale.has(cwd))
    })().finally(() => refreshing.delete(cwd))
    refreshing.set(cwd, run)
    return run
  }

  const publish = async (cwd: string, next: Catalog) => {
    const attached = Array.from(sessions.values()).filter((state) => FSUtil.resolve(state.cwd) === FSUtil.resolve(cwd))
    await Promise.all(
      attached.map(async (state) => {
        const options = stableStringify(configOptions(state))
        const commands = stableStringify(state.catalog.commands)
        state.catalog = next
        if (stableStringify(configOptions(state)) !== options) {
          await input.connection.sessionUpdate({
            sessionId: state.id,
            update: { sessionUpdate: "config_option_update", configOptions: configOptions(state) },
          })
        }
        if (stableStringify(next.commands) !== commands) await sendCommands(state)
      }),
    ).catch(() => {})
  }

  const sendCommands = (state: Attached) =>
    input.connection.sessionUpdate({
      sessionId: state.id,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: state.catalog.commands.map((command) => ({
          name: command.name,
          description: command.description ?? "",
        })),
      },
    })

  // A client may pick a value from a newer catalog than this process has seen.
  const refreshed = async (state: Attached, found: (catalog: Catalog) => boolean) => {
    if (found(state.catalog)) return
    await refresh(state.cwd)
  }

  const requireSession = async (sessionID: string) => {
    const current = sessions.get(sessionID)
    if (current) return current
    throw new ACPError.SessionNotFoundError({ sessionId: sessionID })
  }

  const detach = (sessionID: string) => {
    sessions.get(sessionID)?.abort.abort()
    sessions.delete(sessionID)
    registeredMcp.delete(sessionID)
  }

  const cancelTurn = (sessionID: string) => {
    const turn = active.get(sessionID)
    if (turn) {
      turn.control.cancelled = true
      turn.control.admission.abort()
    }
    return input.client.session.interrupt({ sessionID })
  }

  const attach = async (session: SessionInfo, cwd: string, mcpServers: readonly McpServer[]) => {
    const currentCatalog = await catalog(cwd)
    sessions.get(session.id)?.abort.abort()
    const state: Attached = {
      id: session.id,
      cwd,
      abort: new AbortController(),
      catalog: currentCatalog,
      model: session.model,
      modeID: session.agent,
    }
    sessions.set(session.id, state)
    await registerMcpServers(input.client, registeredMcp, state, mcpServers)
    await sendCommands(state)
    return state
  }

  const replay = async (state: Attached) => {
    await replayMessages(input.connection, state.id, state.cwd, await messages(input.client, state.id))
  }

  const configOptions = (state: Attached) => {
    const model = currentModel(state)
    return buildConfigOptions({
      providers: state.catalog.providers,
      currentModel: { providerID: model.providerID, modelID: model.id },
      currentVariant: model.variant,
      modes: state.catalog.modes,
      currentModeId: state.modeID ?? state.catalog.defaultModeID,
    })
  }

  return {
    initialize: async (params) => {
      capabilities.writeTextFile = params.clientCapabilities?.fs?.writeTextFile === true
      capabilities.childSessionUpdates = params.clientCapabilities?._meta?.[ChildSessionUpdatesCapability] === true
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
          sessionCapabilities: { close: {}, delete: {}, fork: {}, list: {}, resume: {} },
          _meta: { [ChildSessionUpdatesCapability]: true },
        },
        authMethods: [authMethod],
        agentInfo: { name: "OpenCode", version: OPENCODE_VERSION },
      }
    },
    authenticate: async (params) => {
      if (params.methodId !== AuthMethodID) throw new ACPError.UnknownAuthMethodError({ methodId: params.methodId })
      return {}
    },
    newSession: async (params) => {
      await catalog(params.cwd)
      // Leave agent and model unset so the server resolves its defaults after plugins activate,
      // even when this catalog was read before configured agents and models appeared.
      const created = await input.client.session.create({ location: { directory: params.cwd } })
      const state = await attach(created, params.cwd, params.mcpServers)
      return { sessionId: state.id, configOptions: configOptions(state) }
    },
    loadSession: async (params) => {
      const session = await getSession(input.client, params.sessionId, params.cwd)
      const state = await attach(session, session.location.directory, params.mcpServers)
      await replay(state)
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
          title: withTimestampedFallback(session),
          updatedAt: new Date(session.time.updated).toISOString(),
        })),
        ...(page.cursor.next ? { nextCursor: page.cursor.next } : {}),
      }
    },
    deleteSession: async (params) => {
      await input.client.session.remove({ sessionID: params.sessionId }).catch((error) => {
        if (!isSessionNotFoundError(error)) throw error
      })
      detach(params.sessionId)
      return {}
    },
    resumeSession: async (params) => {
      const session = await getSession(input.client, params.sessionId, params.cwd)
      const state = await attach(session, session.location.directory, params.mcpServers ?? [])
      return { configOptions: configOptions(state) }
    },
    closeSession: async (params) => {
      const turn = active.get(params.sessionId)
      await cancelTurn(params.sessionId).catch((error) => {
        if (!isSessionNotFoundError(error)) throw error
      })
      await turn?.turn.catch(() => {})
      detach(params.sessionId)
      return {}
    },
    forkSession: async (params) => {
      const forked = await input.client.session.fork({
        sessionID: params.sessionId,
      })
      const state = await attach(forked, forked.location.directory, params.mcpServers ?? [])
      await replay(state)
      return { sessionId: state.id, configOptions: configOptions(state) }
    },
    setSessionConfigOption: async (params) => {
      const state = await requireSession(params.sessionId)
      if (typeof params.value !== "string") throw new ACPError.InvalidConfigOptionError({ configId: params.configId })
      switch (params.configId) {
        case "model": {
          const value = params.value
          await refreshed(state, (catalog) => hasModel(catalog, value))
          const selected = requireModel(state.catalog, value, currentModel(state))
          state.model = selected
          await input.client.session.switchModel({ sessionID: state.id, model: selected })
          break
        }
        case "effort": {
          const current = currentModel(state)
          const model = state.catalog.models.find(
            (item) => item.providerID === current.providerID && item.id === current.id,
          )
          if (
            !model ||
            (params.value !== DEFAULT_VARIANT_VALUE && !model.variants.some((variant) => variant.id === params.value))
          )
            throw new ACPError.InvalidEffortError({ effort: params.value })
          state.model = { ...current, variant: params.value }
          await input.client.session.switchModel({ sessionID: state.id, model: state.model })
          break
        }
        case "mode": {
          const value = params.value
          await refreshed(state, (catalog) => hasMode(catalog, value))
          await selectMode(input.client, state, value)
          break
        }
        default:
          throw new ACPError.InvalidConfigOptionError({ configId: params.configId })
      }
      return { configOptions: configOptions(state) }
    },
    setSessionMode: async (params) => {
      const state = await requireSession(params.sessionId)
      await refreshed(state, (catalog) => hasMode(catalog, params.modeId))
      await selectMode(input.client, state, params.modeId)
      return {}
    },
    prompt: async (params, signal) => {
      const state = await requireSession(params.sessionId)
      if (active.has(state.id)) {
        throw new ACPError.ServiceFailureError({
          safeMessage: `Session already has an active ACP prompt: ${state.id}`,
          service: "session",
        })
      }
      const messageID = SessionMessage.ID.create()
      const prepared = preparePrompt(state.catalog, params.prompt, messageID)
      const control: TurnControl = { cancelled: false, admission: new AbortController() }
      const extNotification = input.connection.extNotification
      const childSessionUpdate =
        capabilities.childSessionUpdates && extNotification
          ? (update: ChildSessionUpdate) => extNotification(ChildSessionUpdateMethod, update).then(() => {})
          : undefined
      // A `$/cancel_request` for this prompt behaves like `session/cancel` for its turn.
      const cancel = () => void cancelTurn(state.id).catch(() => {})
      const turn = streamTurn({
        client: input.client,
        connection: input.connection,
        sessionID: state.id,
        cwd: state.cwd,
        start: prepared.start,
        writeTextFile: capabilities.writeTextFile,
        action: prepared.command !== undefined,
        control,
        connectionSignal: input.connection.signal,
        sessionSignal: state.abort.signal,
        submit: (signal) => submitPrompt(input.client, state, prepared, signal),
        ...(childSessionUpdate ? { childSessionUpdate } : {}),
      })
        .then(async (response) => {
          await sendUsageUpdate(input.client, input.connection, state, response.usage?.totalTokens).catch(() => {})
          return response
        })
        .finally(() => {
          signal?.removeEventListener("abort", cancel)
          if (active.get(state.id)?.control === control) active.delete(state.id)
        })
      active.set(state.id, { control, turn })
      signal?.addEventListener("abort", cancel, { once: true })
      // The cancel may already be buffered behind the awaits above.
      if (signal?.aborted) cancel()
      return turn
    },
    cancel: async (params) => {
      await cancelTurn(params.sessionId).catch(() => {})
    },
  }
}

function preparePrompt(catalog: Catalog, prompt: PromptRequest["prompt"], messageID: string): PreparedPrompt {
  const parts = promptContentToParts(prompt)
  const visible = parts.filter((part) => part.type !== "text" || (!part.synthetic && !part.ignored))
  const synthetic = parts.flatMap((part) => (part.type === "text" && part.synthetic ? [part.text] : []))
  const text = visible.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  const files = visible.flatMap((part) => (part.type === "file" ? [{ uri: part.url, name: part.filename }] : []))
  const slash = detectSlashCommand(text)
  const command = slash ? catalog.commands.find((item) => item.name === slash.name) : undefined
  const start = turnStart(messageID, slash)
  return { start, text, files, synthetic, slash, command }
}

async function submitPrompt(client: OpenCodeClient, session: Attached, prompt: PreparedPrompt, signal: AbortSignal) {
  if (prompt.synthetic.length > 0) {
    await client.session.synthetic({
      sessionID: session.id,
      text: prompt.synthetic.join("\n\n"),
      description: "ACP embedded context",
      delivery: "steer",
      resume: false,
    })
  }
  if (prompt.start.type === "compaction") return client.session.compact({ sessionID: session.id, id: prompt.start.id })
  if (prompt.command) {
    return client.session.command(
      {
        sessionID: session.id,
        name: prompt.command.name,
        text: prompt.slash?.args ?? "",
        files: prompt.files,
        delivery: "steer",
      },
      { signal },
    )
  }
  return client.session.prompt(
    { sessionID: session.id, id: prompt.start.id, text: prompt.text, files: prompt.files, delivery: "steer" },
    { signal },
  )
}

function turnStart(messageID: string, slash: PreparedPrompt["slash"]): TurnStart {
  if (slash?.name === "compact") return { type: "compaction", id: messageID }
  return { type: "input", id: messageID }
}

async function loadCatalog(client: OpenCodeClient, cwd: string): Promise<Catalog> {
  const location = { directory: cwd }
  // Some providers discover models in the background after plugin startup begins.
  const deadline = Date.now() + 5_000
  let missing = "No models are available"
  while (Date.now() < deadline) {
    const [modelResult, defaultResult, agentResult, commandResult] = await Promise.all([
      client.model.list({ location }),
      client.model.default({ location }),
      client.agent.list({ location }),
      client.command.list({ location }),
    ])
    const models = modelResult.data.filter((model) => model.enabled)
    const preferred = defaultResult.data
    // Parallel reads can straddle initialization; select only from this model list.
    const defaultModel = preferred
      ? models.find((model) => model.providerID === preferred.providerID && model.id === preferred.id)
      : models[0]
    const agents = agentResult.data.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
    const defaultAgent = agents.find((agent) => agent.mode === "primary") ?? agents[0]
    if (defaultModel && defaultAgent) {
      return {
        providers: providers(models),
        models,
        defaultModel: {
          providerID: defaultModel.providerID,
          id: defaultModel.id,
          variant: defaultModel.variants.find((variant) => variant.id === "default")?.id,
        },
        modes: agents.map((agent) => ({ id: agent.id, name: agent.name, description: agent.description })),
        defaultModeID: defaultAgent.id,
        commands: commandResult.data,
      }
    }
    missing = defaultModel ? "No primary agents are available" : "No models are available"
    await Bun.sleep(25)
  }
  throw new Error(missing)
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

function requireModel(catalog: Catalog, modelID: string, current: ModelRef): ModelRef {
  const selected = parseModelSelection(modelID, catalog.providers)
  const model = catalog.models.find(
    (item) => item.providerID === selected.model.providerID && item.id === selected.model.modelID,
  )
  if (!model) throw new ACPError.InvalidModelError({ providerId: selected.model.providerID, modelId: modelID })
  if (selected.variant && !model.variants.some((variant) => variant.id === selected.variant))
    throw new ACPError.InvalidEffortError({ effort: selected.variant })
  const variant =
    selected.variant ??
    (current.providerID === model.providerID &&
    current.id === model.id &&
    (current.variant === DEFAULT_VARIANT_VALUE || model.variants.some((variant) => variant.id === current.variant))
      ? current.variant
      : undefined)
  return { providerID: model.providerID, id: model.id, variant }
}

function currentModel(state: Attached) {
  return state.model ?? state.catalog.defaultModel
}

function hasModel(catalog: Catalog, value: string) {
  const selected = parseModelSelection(value, catalog.providers)
  return catalog.models.some(
    (model) => model.providerID === selected.model.providerID && model.id === selected.model.modelID,
  )
}

function hasMode(catalog: Catalog, modeID: string) {
  return catalog.modes.some((mode) => mode.id === modeID)
}

async function selectMode(client: OpenCodeClient, state: Attached, modeID: string) {
  if (!hasMode(state.catalog, modeID)) throw new ACPError.InvalidModeError({ mode: modeID })
  state.modeID = modeID
  await client.session.switchAgent({ sessionID: state.id, agent: modeID })
}

async function getSession(client: OpenCodeClient, sessionID: string, cwd: string) {
  const session = await client.session.get({ sessionID }).catch((error) => {
    if (isSessionNotFoundError(error)) throw new ACPError.SessionNotFoundError({ sessionId: sessionID })
    throw error
  })
  if (FSUtil.resolve(cwd) !== FSUtil.resolve(session.location.directory)) {
    throw new ACPError.SessionDirectoryMismatchError({ sessionId: sessionID, cwd })
  }
  return session
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
    if (server.type === "acp") throw new Error("MCP-over-ACP is not supported")
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

async function sendUsageUpdate(
  client: OpenCodeClient,
  connection: ACPConnection.Connection,
  session: Attached,
  used?: number,
) {
  if (!used) return
  const current = currentModel(session)
  const model = session.catalog.models.find((item) => item.providerID === current.providerID && item.id === current.id)
  if (!model?.limit.context) return
  const info = await client.session.get({ sessionID: session.id })
  await connection.sessionUpdate({
    sessionId: session.id,
    update: {
      sessionUpdate: "usage_update",
      used,
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
