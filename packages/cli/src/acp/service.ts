import { isDeepStrictEqual } from "node:util"
import {
  isSessionNotFoundError,
  type CommandInfo,
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
import { ACPCatalog, type Catalog } from "./catalog"
import { buildConfigOptions, DEFAULT_VARIANT_VALUE, parseModelSelection } from "./config-option"
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

// Model and mode are unset while the session follows the server defaults.
type Attached = {
  readonly id: string
  readonly cwd: string
  readonly abort: AbortController
  readonly catalog: ACPCatalog.Live
  model?: ModelRef
  modeID?: string
}

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
  const registeredMcp = new Map<string, Set<string>>()
  const active = new Map<string, { readonly control: TurnControl; readonly turn: Promise<PromptResponse> }>()
  const capabilities = { childSessionUpdates: false }

  const catalogs = ACPCatalog.make({
    client: input.client,
    signal: input.connection.signal,
    changed: (live, previous) =>
      Promise.all(
        Array.from(sessions.values())
          .filter((state) => state.catalog === live)
          .map(async (state) => {
            const options = configOptions(state)
            if (!isDeepStrictEqual(options, configOptions(state, previous))) {
              await input.connection.sessionUpdate({
                sessionId: state.id,
                update: { sessionUpdate: "config_option_update", configOptions: options },
              })
            }
            if (!isDeepStrictEqual(live.current.commands, previous.commands)) await sendCommands(state)
          }),
      ),
  })

  const sendCommands = (state: Attached) =>
    input.connection.sessionUpdate({
      sessionId: state.id,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: state.catalog.current.commands.map((command) => ({
          name: command.name,
          description: command.description ?? "",
        })),
      },
    })

  const withReload = <A>(state: Attached, select: () => Promise<A>) =>
    select().catch(async (error: unknown) => {
      if (
        !(
          error instanceof ACPError.InvalidModelError ||
          error instanceof ACPError.InvalidModeError ||
          error instanceof ACPError.InvalidEffortError
        )
      )
        throw error
      await catalogs.reload(state.catalog)
      return select()
    })

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
    const catalog = await catalogs.get(cwd)
    sessions.get(session.id)?.abort.abort()
    const state: Attached = {
      id: session.id,
      cwd,
      abort: new AbortController(),
      catalog,
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

  const configOptions = (state: Attached, catalog = state.catalog.current) => {
    const model = currentModel(state, catalog)
    return buildConfigOptions({
      providers: catalog.providers,
      currentModel: { providerID: model.providerID, modelID: model.id },
      currentVariant: model.variant,
      modes: catalog.modes,
      currentModeId: state.modeID ?? catalog.defaultModeID,
    })
  }

  return {
    initialize: async (params) => {
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
      // Load before creating so a catalog failure leaves no session behind. Agent and model stay unset
      // so the server resolves its defaults after plugins activate.
      await catalogs.get(params.cwd)
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
      const value = params.value
      if (typeof value !== "string") throw new ACPError.InvalidConfigOptionError({ configId: params.configId })
      await withReload(state, async () => {
        switch (params.configId) {
          case "model": {
            const selected = requireModel(state.catalog.current, value, currentModel(state))
            state.model = selected
            await input.client.session.switchModel({ sessionID: state.id, model: selected })
            return
          }
          case "effort": {
            const current = currentModel(state)
            const model = state.catalog.current.models.find(
              (item) => item.providerID === current.providerID && item.id === current.id,
            )
            if (!model || (value !== DEFAULT_VARIANT_VALUE && !model.variants.some((variant) => variant.id === value)))
              throw new ACPError.InvalidEffortError({ effort: value })
            state.model = { ...current, variant: value }
            await input.client.session.switchModel({ sessionID: state.id, model: state.model })
            return
          }
          case "mode":
            return selectMode(input.client, state, value)
          default:
            throw new ACPError.InvalidConfigOptionError({ configId: params.configId })
        }
      })
      return { configOptions: configOptions(state) }
    },
    setSessionMode: async (params) => {
      const state = await requireSession(params.sessionId)
      await withReload(state, () => selectMode(input.client, state, params.modeId))
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
      const prepared = preparePrompt(state.catalog.current, params.prompt, messageID)
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
        action: prepared.command !== undefined,
        control,
        connectionSignal: input.connection.signal,
        sessionSignal: state.abort.signal,
        submit: (signal) => submitPrompt(input.client, state, prepared, signal),
        ...(childSessionUpdate ? { childSessionUpdate } : {}),
      })
        .then(async (result) => {
          await sendUsageUpdate(input.client, input.connection, state, result.contextTokens).catch(() => {})
          return result.response
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

function currentModel(state: Attached, catalog = state.catalog.current) {
  return state.model ?? catalog.defaultModel
}

async function selectMode(client: OpenCodeClient, state: Attached, modeID: string) {
  if (!state.catalog.current.modes.some((mode) => mode.id === modeID))
    throw new ACPError.InvalidModeError({ mode: modeID })
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
  const model = session.catalog.current.models.find(
    (item) => item.providerID === current.providerID && item.id === current.id,
  )
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
