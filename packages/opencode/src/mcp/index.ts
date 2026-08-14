import path from "node:path"
import { pathToFileURL } from "node:url"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { type Tool } from "ai"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import {
  Client,
  type ClientOptions,
  StreamableHTTPClientTransport,
  SSEClientTransport,
  UnauthorizedError,
  type LoggingMessageNotification,
  type PriorDiscovery,
  LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { Config } from "@/config/config"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { NamedError } from "@opencode-ai/core/util/error"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { withTimeout } from "@/util/timeout"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { McpOAuthProvider, OAUTH_CALLBACK_PATH } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { TuiEvent } from "@/server/tui-event"
import open from "open"
import { Cause, Effect, Exit, Layer, Option, Context, Schema, Stream } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { McpCatalog, type MCPToolDef } from "./catalog"

const DEFAULT_TIMEOUT = 30_000
const CLIENT_OPTIONS = {
  capabilities: {
    // https://github.com/anomalyco/opencode/issues/11948
    // sampling: {},
    // https://github.com/anomalyco/opencode/issues/23066
    // elicitation: {},
    // https://github.com/anomalyco/opencode/issues/2308
    roots: {},
    // https://github.com/anomalyco/opencode/issues/28567
    // tasks: {},
  },
} satisfies ClientOptions

export const Resource = Schema.Struct({
  name: Schema.String,
  uri: Schema.String,
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  client: Schema.String,
}).annotate({ identifier: "McpResource" })
export type Resource = Schema.Schema.Type<typeof Resource>

export const ToolsChanged = EventV2.define({
  type: "mcp.tools.changed",
  schema: {
    server: Schema.String,
  },
})

export const BrowserOpenFailed = EventV2.define({
  type: "mcp.browser.open.failed",
  schema: {
    mcpName: Schema.String,
    url: Schema.String,
  },
})

export class Failed extends Schema.TaggedErrorClass<Failed>()("MCPFailed", {
  name: Schema.String,
}) {
  override get message() {
    return `MCP operation failed for ${this.name}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MCP.NotFoundError", {
  name: Schema.String,
}) {}

type MCPClient = Client

function createClient(directory: string, versionNegotiation: NonNullable<ClientOptions["versionNegotiation"]>) {
  const client = new Client({ name: "opencode", version: InstallationVersion }, { ...CLIENT_OPTIONS, versionNegotiation })
  client.setRequestHandler("roots/list", () =>
    Promise.resolve({ roots: [{ uri: pathToFileURL(directory).href }] }),
  )
  return client
}

const StatusConnected = Schema.Struct({
  status: Schema.Literal("connected"),
  // fork(mcp-dual-era-client B3): connection diagnostics, populated from the
  // negotiated Client after a successful connect (see diagnosticsFor()).
  era: Schema.optional(Schema.Union([Schema.Literal("legacy"), Schema.Literal("modern")])).annotate({
    description: "Negotiated protocol era for this connection",
  }),
  protocolVersion: Schema.optional(Schema.String).annotate({
    description: "Negotiated MCP protocol revision, when known",
  }),
  transport: Schema.optional(Schema.String).annotate({
    description: "Transport that succeeded: StreamableHTTP, SSE, or stdio",
  }),
  capabilities: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Top-level server capability keys (e.g. tools, resources, prompts)",
  }),
}).annotate({
  identifier: "MCPStatusConnected",
})
const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCPStatusDisabled",
})
const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCPStatusFailed",
})
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCPStatusNeedsAuth",
})
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCPStatusNeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
]).annotate({ identifier: "MCPStatus", discriminator: "status" })
export type Status = Schema.Schema.Type<typeof Status>

// Store transports for OAuth servers to allow finishing auth
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
const pendingOAuthTransports = new Map<string, TransportWithAuth>()

// Prompt cache types
type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
type ResourceTemplateInfo = Awaited<ReturnType<MCPClient["listResourceTemplates"]>>["resourceTemplates"][number]
type McpEntry = NonNullable<ConfigV1.Info["mcp"]>[string]

function isMcpConfigured(entry: McpEntry): entry is ConfigMCPV1.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

function remoteURL(value: string) {
  if (URL.canParse(value)) return new URL(value)
}

// fork(mcp-dual-era-client B1): our config vocabulary is legacy/auto/modern;
// the SDK's own is legacy/auto/{pin}. "modern" maps to pinning the latest
// revision — strict, no fallback, matching the proposal's "mainly for test
// fixtures" intent. versionNegotiation is a ClientOptions field (constructor
// time), not a per-connect() option, and its own SDK default is 'legacy' —
// we override that default to 'auto' so an unconfigured server still gets a
// chance to speak the modern era instead of silently staying pinned to 2025.
function versionNegotiationFor(mode: ConfigMCPV1.ProtocolMode): NonNullable<ClientOptions["versionNegotiation"]> {
  if (mode === "modern") return { mode: { pin: LATEST_PROTOCOL_VERSION } }
  return { mode }
}

function resolveProtocolMode(cfg: ConfigV1.Info, mcp: ConfigMCPV1.Info): ConfigMCPV1.ProtocolMode {
  return mcp.protocolMode ?? cfg.experimental?.mcp_protocol_mode ?? "auto"
}

interface CreateResult {
  mcpClient?: MCPClient
  status: Status
  defs?: MCPToolDef[]
}

interface AuthResult {
  authorizationUrl: string
  oauthState: string
  client?: MCPClient
}

// --- Effect Service ---

/**
 * A tool as the registry consumes it: the cached definition plus the client to
 * invoke it through. Conversion to an ai-sdk Tool happens at the call site, not
 * here — the MCP service stays free of tool-loop concerns.
 */
export interface McpTool {
  /** Shared cached definition; consumers must copy rather than mutate it. */
  readonly def: MCPToolDef
  readonly client: MCPClient
  readonly timeout?: number
}

export interface ServerInstructions {
  name: string
  instructions: string
  tools: string[]
}

interface State {
  config: Record<string, ConfigMCPV1.Info>
  status: Record<string, Status>
  clients: Record<string, MCPClient>
  defs: Record<string, MCPToolDef[]>
  instructions: Record<string, string>
  // fork(mcp-dual-era-client B2): cached era verdict per server, adopted on
  // reconnect via ConnectOptions.prior so a known-legacy server never repeats
  // the server/discover probe within the same process. Never cleared on
  // disconnect — only a fresh process re-probes.
  priorDiscovery: Record<string, PriorDiscovery>
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly clients: () => Effect.Effect<Record<string, MCPClient>>
  readonly instructions: () => Effect.Effect<ServerInstructions[]>
  readonly tools: () => Effect.Effect<Record<string, McpTool>>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly resourceTemplates: () => Effect.Effect<Record<string, ResourceTemplateInfo & { client: string }>>
  readonly add: (name: string, mcp: ConfigMCPV1.Info) => Effect.Effect<{ status: Record<string, Status> | Status }>
  readonly connect: (name: string) => Effect.Effect<void, NotFoundError>
  readonly disconnect: (name: string) => Effect.Effect<void, NotFoundError>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
  readonly startAuth: (
    mcpName: string,
  ) => Effect.Effect<{ authorizationUrl: string; oauthState: string }, NotFoundError>
  readonly authenticate: (
    mcpName: string,
    onAuthorization?: (authorizationUrl: string) => void,
  ) => Effect.Effect<Status, NotFoundError>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status, NotFoundError>
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean, NotFoundError>
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MCP") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const auth = yield* McpAuth.Service
    const events = yield* EventV2Bridge.Service
    const cfgSvc = yield* Config.Service

    type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

    /**
     * Connect a client via the given transport with resource safety:
     * on failure the transport is closed; on success the caller owns it.
     * `prior`, when given (B2), short-circuits era negotiation entirely —
     * takes precedence over the client's own `versionNegotiation` mode.
     */
    const connectTransport = Effect.fn("MCP.connectTransport")(function* (
      transport: Transport,
      timeout: number,
      versionNegotiation: NonNullable<ClientOptions["versionNegotiation"]>,
      prior: PriorDiscovery | undefined,
    ) {
      const directory = yield* InstanceState.directory
      return yield* Effect.acquireUseRelease(
        Effect.succeed(transport),
        (t) =>
          Effect.tryPromise({
            try: () => {
              const client = createClient(directory, versionNegotiation)
              return withTimeout(client.connect(t, prior ? { prior } : undefined), timeout).then(() => client)
            },
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }),
        (t, exit) => (Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void),
      )
    })

    // fork(mcp-dual-era-client B2/B3): read back what actually got negotiated
    // after a successful connect — both to cache the verdict for the next
    // reconnect (PriorDiscovery) and to populate connection diagnostics.
    // getDiscoverResult() is defined only on a modern connection; its
    // presence/absence IS the era signal (no dedicated getter exists).
    function diagnosticsFor(client: MCPClient, transport: string) {
      const discover = client.getDiscoverResult()
      const era: "legacy" | "modern" = discover ? "modern" : "legacy"
      const prior: PriorDiscovery = discover ? { kind: "modern", discover } : { kind: "legacy" }
      // fork: capability discovery failing is a real, expected failure mode
      // (create()'s own explicit getServerCapabilities() check handles it
      // with proper client.close() cleanup) — never let reading it here for
      // diagnostics purposes throw a defect earlier in the pipeline instead.
      let capabilities: string[] = []
      try {
        capabilities = Object.keys(client.getServerCapabilities() ?? {})
      } catch {}
      return {
        era,
        protocolVersion: client.getNegotiatedProtocolVersion(),
        transport,
        capabilities,
        prior,
      }
    }

    const DISABLED_RESULT: CreateResult = { status: { status: "disabled" } }

    const connectRemote = Effect.fn("MCP.connectRemote")(function* (
      key: string,
      mcp: ConfigMCPV1.Info & { type: "remote" },
      versionNegotiation: NonNullable<ClientOptions["versionNegotiation"]>,
      prior: PriorDiscovery | undefined,
    ) {
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      const url = remoteURL(mcp.url)
      if (!url) {
        return {
          client: undefined as MCPClient | undefined,
          status: { status: "failed" as const, error: `Invalid MCP URL for "${key}"` },
          prior: undefined as PriorDiscovery | undefined,
        }
      }
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
            callbackPort: oauthConfig?.callbackPort,
            redirectUri: oauthConfig?.redirectUri,
          },
          {
            onRedirect: async () => {},
          },
          auth,
        )
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(url, {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      let lastStatus: Status | undefined

      for (const { name, transport } of transports) {
        const result = yield* connectTransport(transport, connectTimeout, versionNegotiation, prior).pipe(
          Effect.map((client) => ({ client, transportName: name })),
          Effect.catch((error) => {
            const lastError = error instanceof Error ? error : new Error(String(error))
            const isAuthError =
              error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

            if (isAuthError) {
              if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                lastStatus = {
                  status: "needs_client_registration" as const,
                  error: "Server does not support dynamic client registration. Please provide clientId in config.",
                }
                return events
                  .publish(TuiEvent.ToastShow, {
                    title: "MCP Authentication Required",
                    message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                    variant: "warning",
                    duration: 8000,
                  })
                  .pipe(Effect.ignore, Effect.as(undefined))
              } else {
                pendingOAuthTransports.set(key, transport)
                lastStatus = { status: "needs_auth" as const }
                return events
                  .publish(TuiEvent.ToastShow, {
                    title: "MCP Authentication Required",
                    message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                    variant: "warning",
                    duration: 8000,
                  })
                  .pipe(Effect.ignore, Effect.as(undefined))
              }
            }

            lastStatus = { status: "failed" as const, error: lastError.message }
            return Effect.void
          }),
        )
        if (result) {
          const diag = diagnosticsFor(result.client, result.transportName)
          return {
            client: result.client,
            status: {
              status: "connected",
              era: diag.era,
              protocolVersion: diag.protocolVersion,
              transport: diag.transport,
              capabilities: diag.capabilities,
            } as Status,
            prior: diag.prior,
          }
        }
        // If this was an auth error, stop trying other transports
        if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
      }

      return {
        client: undefined as MCPClient | undefined,
        status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
        prior: undefined as PriorDiscovery | undefined,
      }
    })

    const connectLocal = Effect.fn("MCP.connectLocal")(function* (
      key: string,
      mcp: ConfigMCPV1.Info & { type: "local" },
      versionNegotiation: NonNullable<ClientOptions["versionNegotiation"]>,
      prior: PriorDiscovery | undefined,
    ) {
      const [cmd, ...args] = mcp.command
      const baseDir = yield* InstanceState.directory
      const cwd = mcp.cwd ? path.resolve(baseDir, mcp.cwd) : baseDir
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
        },
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      return yield* connectTransport(transport, connectTimeout, versionNegotiation, prior).pipe(
        Effect.map((client): { client: MCPClient | undefined; status: Status; prior: PriorDiscovery | undefined } => {
          const diag = diagnosticsFor(client, "stdio")
          return {
            client,
            status: {
              status: "connected",
              era: diag.era,
              protocolVersion: diag.protocolVersion,
              transport: diag.transport,
              capabilities: diag.capabilities,
            },
            prior: diag.prior,
          }
        }),
        Effect.catch(
          (error): Effect.Effect<{ client: MCPClient | undefined; status: Status; prior: PriorDiscovery | undefined }> => {
            const msg = error instanceof Error ? error.message : String(error)
            return Effect.succeed({ client: undefined, status: { status: "failed", error: msg }, prior: undefined })
          },
        ),
      )
    })

    const create = Effect.fn("MCP.create")(
      function* (key: string, mcp: ConfigMCPV1.Info, s: State) {
        if (mcp.enabled === false) {
          return DISABLED_RESULT
        }

        const cfg = yield* cfgSvc.get()
        const versionNegotiation = versionNegotiationFor(resolveProtocolMode(cfg, mcp))
        const prior = s.priorDiscovery[key]

        const { client: mcpClient, status, prior: newPrior } =
          mcp.type === "remote"
            ? yield* connectRemote(key, mcp as ConfigMCPV1.Info & { type: "remote" }, versionNegotiation, prior)
            : yield* connectLocal(key, mcp as ConfigMCPV1.Info & { type: "local" }, versionNegotiation, prior)

        if (newPrior) s.priorDiscovery[key] = newPrior

        if (!mcpClient) {
          if (status.status !== "connected" && status.status !== "disabled") {
            yield* Effect.logWarning("server unavailable", { key, type: mcp.type, status: status.status })
          }
          return { status } satisfies CreateResult
        }

        return yield* Effect.gen(function* () {
          const listed = mcpClient.getServerCapabilities()?.tools ? yield* McpCatalog.defs(mcpClient, mcp.timeout) : []
          if (!listed) {
            return yield* Effect.fail(new Error("Failed to get tools"))
          }
          return { mcpClient, status, defs: listed } satisfies CreateResult
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
          ),
        )
      },
      Effect.map((result): CreateResult => result),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
        const error = Cause.squash(cause)
        return Effect.succeed<CreateResult>({
          status: { status: "failed", error: error instanceof Error ? error.message : String(error) },
        })
      }),
    )

    const descendants = Effect.fnUntraced(
      function* (pid: number) {
        if (process.platform === "win32") return [] as number[]
        const pids: number[] = []
        const queue = [pid]
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index]
          const handle = yield* spawner.spawn(ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }))
          const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          for (const tok of text.split("\n")) {
            const cpid = parseInt(tok, 10)
            if (!isNaN(cpid) && !pids.includes(cpid)) {
              pids.push(cpid)
              queue.push(cpid)
            }
          }
        }
        return pids
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed([] as number[])),
    )

    function watch(s: State, name: string, client: MCPClient, bridge: EffectBridge.Shape, timeout?: number) {
      client.onclose = () => {
        if (s.clients[name] !== client) return
        delete s.clients[name]
        delete s.defs[name]
        s.status[name] = { status: "failed", error: "Connection closed" }
        bridge.fork(
          Effect.logWarning("MCP connection closed", { server: name }).pipe(
            Effect.andThen(events.publish(ToolsChanged, { server: name })),
            Effect.ignore,
          ),
        )
      }

      client.setNotificationHandler("notifications/message", (notification) =>
        bridge.promise(serverLog(name, notification.params)),
      )

      if (!client.getServerCapabilities()?.tools) return
      client.setNotificationHandler("notifications/tools/list_changed", async () => {
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        const listed = await bridge.promise(McpCatalog.defs(client, timeout))
        if (!listed) return
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        s.defs[name] = listed
        setInstructions(s, name, client.getInstructions()?.trim())
        await bridge.promise(events.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
      })
    }

    function serverLog(name: string, params: LoggingMessageNotification["params"]) {
      const fields = { server: name, logger: params.logger, level: params.level, data: params.data }
      switch (params.level) {
        case "debug":
          return Effect.logDebug("MCP server log", fields)
        case "info":
        case "notice":
          return Effect.logInfo("MCP server log", fields)
        case "warning":
          return Effect.logWarning("MCP server log", fields)
        case "error":
        case "critical":
        case "alert":
        case "emergency":
          return Effect.logError("MCP server log", fields)
        default:
          // fork: v2's logging level type widened past the 8-value RFC 5424
          // enum the switch above covers (logging itself is @deprecated,
          // SEP-2577) — never silently drop a server log line.
          return Effect.logInfo("MCP server log", fields)
      }
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("MCP.state")(function* () {
        const cfg = yield* cfgSvc.get()
        const bridge = yield* EffectBridge.make()
        const config = cfg.mcp ?? {}
        const s: State = {
          config: {},
          status: {},
          clients: {},
          defs: {},
          instructions: {},
          priorDiscovery: {},
        }

        yield* Effect.forEach(
          Object.entries(config),
          ([key, mcp]) =>
            Effect.gen(function* () {
              if (!isMcpConfigured(mcp)) {
                yield* Effect.logError("Ignoring MCP config entry without type", { key })
                return
              }

              if (mcp.enabled === false) {
                s.status[key] = { status: "disabled" }
                return
              }

              const result = yield* create(key, mcp, s)
              s.status[key] = result.status
              if (result.mcpClient) {
                s.clients[key] = result.mcpClient
                s.defs[key] = result.defs!
                setInstructions(s, key, result.mcpClient.getInstructions()?.trim())
                watch(s, key, result.mcpClient, bridge, mcp.timeout)
              }
            }),
          { concurrency: "unbounded" },
        )

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            const clients = Object.values(s.clients)
            s.clients = {}
            s.defs = {}
            yield* Effect.forEach(
              clients,
              (client) =>
                Effect.gen(function* () {
                  const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : null
                  if (typeof pid === "number") {
                    const pids = yield* descendants(pid)
                    for (const dpid of pids) {
                      try {
                        process.kill(dpid, "SIGTERM")
                      } catch {}
                    }
                  }
                  yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
                }),
              { concurrency: "unbounded" },
            )
            pendingOAuthTransports.clear()
          }),
        )

        return s
      }),
    )

    function closeClient(s: State, name: string) {
      const client = s.clients[name]
      delete s.clients[name]
      delete s.defs[name]
      if (!client) return Effect.void
      return Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
    }

    const storeClient = Effect.fnUntraced(function* (
      s: State,
      name: string,
      client: MCPClient,
      listed: MCPToolDef[],
      timeout?: number,
      status?: Status,
    ) {
      const bridge = yield* EffectBridge.make()
      const previous = s.clients[name]
      // fork(mcp-dual-era-client B3): accept an already-diagnosed status
      // (era/protocolVersion/transport/capabilities) from the caller instead
      // of hardcoding a bare "connected" — this used to silently discard the
      // diagnostics createAndStore had just computed moments earlier.
      s.status[name] = status ?? { status: "connected" }
      s.clients[name] = client
      s.defs[name] = listed
      setInstructions(s, name, client.getInstructions()?.trim())
      watch(s, name, client, bridge, timeout)
      if (previous) yield* Effect.tryPromise(() => previous.close()).pipe(Effect.ignore)
      return s.status[name]
    })

    const status = Effect.fn("MCP.status")(function* () {
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const result: Record<string, Status> = {}

      for (const [key, mcp] of Object.entries(config)) {
        if (!isMcpConfigured(mcp)) continue
        result[key] = s.status[key] ?? { status: "disabled" }
      }

      for (const key of Object.keys(s.config)) {
        result[key] = s.status[key] ?? { status: "disabled" }
      }

      return result
    })

    const clients = Effect.fn("MCP.clients")(function* () {
      const s = yield* InstanceState.get(state)
      return s.clients
    })

    const createAndStore = Effect.fn("MCP.createAndStore")(function* (name: string, mcp: ConfigMCPV1.Info) {
      const s = yield* InstanceState.get(state)
      const result = yield* create(name, mcp, s)

      s.status[name] = result.status
      if (!result.mcpClient) {
        yield* closeClient(s, name)
        delete s.clients[name]
        return result.status
      }

      return yield* storeClient(s, name, result.mcpClient, result.defs!, mcp.timeout, result.status)
    })

    const add = Effect.fn("MCP.add")(function* (name: string, mcp: ConfigMCPV1.Info) {
      const s = yield* InstanceState.get(state)
      s.config[name] = mcp
      yield* createAndStore(name, mcp)
      return { status: s.status }
    })

    const connect = Effect.fn("MCP.connect")(function* (name: string) {
      const mcp = yield* requireMcpConfig(name)
      yield* createAndStore(name, { ...mcp, enabled: true })
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      yield* requireMcpConfig(name)
      const s = yield* InstanceState.get(state)
      yield* closeClient(s, name)
      delete s.clients[name]
      s.status[name] = { status: "disabled" }
    })

    function requestTimeout(s: State, name: string, configured: McpEntry | undefined, fallback?: number) {
      const staticTimeout = configured && isMcpConfigured(configured) ? configured.timeout : undefined
      return s.config[name]?.timeout ?? staticTimeout ?? fallback
    }

    function setInstructions(s: State, name: string, instructions: string | undefined) {
      if (instructions) s.instructions[name] = instructions
      else delete s.instructions[name]
    }

    const instructions = Effect.fn("MCP.instructions")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.entries(s.instructions)
        .filter(([name]) => s.status[name]?.status === "connected")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, item]) => ({
          name,
          instructions: item,
          tools: (s.defs[name] ?? []).map((tool) => McpCatalog.toolName(name, tool.name)),
        }))
    })

    const tools = Effect.fn("MCP.tools")(function* () {
      const result: Record<string, McpTool> = {}
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const defaultTimeout = cfg.experimental?.mcp_timeout

      for (const [clientName, client] of Object.entries(s.clients)) {
        if (s.status[clientName]?.status !== "connected") continue
        const mcpConfig = config[clientName]
        const listed = s.defs[clientName]
        if (!listed) {
          yield* Effect.logWarning("missing cached tools for connected server", { clientName })
          continue
        }
        const timeout = requestTimeout(s, clientName, mcpConfig, defaultTimeout)
        // fork(mcp-dual-era-client C1): filter to the configured tool profile
        // BEFORE conversion — an allowlisted server's unlisted tools never
        // reach convertTool/dynamicTool, so they never enter the model's
        // context at all, not merely get hidden from a UI.
        const profileName = mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig.toolProfile : undefined
        const allowlist = profileName ? cfg.mcpToolProfiles?.[profileName] : undefined
        if (profileName && !allowlist) {
          // Fail closed: a toolProfile referencing a missing/misspelled
          // mcpToolProfiles entry must not silently fall back to exposing
          // every tool — that's the exact bloat this feature exists to stop.
          yield* Effect.logWarning("mcpToolProfiles has no entry for the configured toolProfile — exposing no tools", {
            clientName,
            profileName,
          })
        }
        const filtered = profileName ? listed.filter((mcpTool) => (allowlist ?? []).includes(mcpTool.name)) : listed
        for (const def of filtered) {
          result[McpCatalog.toolName(clientName, def.name)] = { def, client, timeout }
        }
      }
      return result
    })

    function collectFromConnected<T extends { name: string }>(
      s: State,
      listFn: (c: Client, timeout?: number) => Promise<T[]>,
      label: string,
    ) {
      return Effect.gen(function* () {
        const cfg = yield* cfgSvc.get()
        return yield* Effect.forEach(
          Object.entries(s.clients).filter(([name]) => s.status[name]?.status === "connected"),
          ([clientName, client]) =>
            McpCatalog.fetch(
              clientName,
              client,
              (c) => listFn(c, requestTimeout(s, clientName, cfg.mcp?.[clientName], cfg.experimental?.mcp_timeout)),
              label,
            ).pipe(Effect.map((items) => Object.entries(items ?? {}))),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
      })
    }

    const prompts = Effect.fn("MCP.prompts")(function* () {
      return yield* collectFromConnected(yield* InstanceState.get(state), McpCatalog.prompts, "prompts")
    })

    const resources = Effect.fn("MCP.resources")(function* () {
      return yield* collectFromConnected(yield* InstanceState.get(state), McpCatalog.resources, "resources")
    })

    const resourceTemplates = Effect.fn("MCP.resourceTemplates")(function* () {
      return yield* collectFromConnected(
        yield* InstanceState.get(state),
        McpCatalog.resourceTemplates,
        "resource templates",
      )
    })

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      fn: (client: MCPClient, timeout?: number) => Promise<A>,
      label: string,
      meta?: Record<string, unknown>,
    ) {
      const s = yield* InstanceState.get(state)
      const client = s.clients[clientName]
      if (!client) {
        yield* Effect.logWarning(`client not found for ${label}`, { clientName })
        return undefined
      }
      const cfg = yield* cfgSvc.get()
      return yield* Effect.tryPromise({
        try: () => fn(client, requestTimeout(s, clientName, cfg.mcp?.[clientName], cfg.experimental?.mcp_timeout)),
        catch: (error) => error,
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError(`failed to ${label}`, {
            clientName,
            ...meta,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
        Effect.orElseSucceed(() => undefined),
      )
    })

    const getPrompt = Effect.fn("MCP.getPrompt")(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) {
      return yield* withClient(
        clientName,
        (client, timeout) => client.getPrompt({ name, arguments: args }, { timeout }),
        "getPrompt",
        { promptName: name },
      )
    })

    const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
      return yield* withClient(
        clientName,
        (client, timeout) => client.readResource({ uri: resourceUri }, { timeout }),
        "readResource",
        { resourceUri },
      )
    })

    const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const s = yield* InstanceState.get(state)
      if (s.config[mcpName]) return s.config[mcpName]

      const cfg = yield* cfgSvc.get()
      const mcpConfig = cfg.mcp?.[mcpName]
      if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
      return mcpConfig
    })

    const requireMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const mcpConfig = yield* getMcpConfig(mcpName)
      if (!mcpConfig) return yield* new NotFoundError({ name: mcpName })
      return mcpConfig
    })

    const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
      const mcpConfig = yield* requireMcpConfig(mcpName)
      if (mcpConfig.type !== "remote") throw new Error(`MCP server ${mcpName} is not a remote server`)
      if (mcpConfig.oauth === false) throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
      const url = remoteURL(mcpConfig.url)
      if (!url) throw new Error(`Invalid MCP URL for "${mcpName}"`)

      // OAuth config is optional - if not provided, we'll use auto-discovery
      const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined

      // Resolve effective redirect URI: explicit redirectUri > callbackPort shorthand > default
      const effectiveRedirectUri =
        oauthConfig?.redirectUri ??
        (oauthConfig?.callbackPort ? `http://127.0.0.1:${oauthConfig.callbackPort}${OAUTH_CALLBACK_PATH}` : undefined)

      // Start the callback server with custom redirectUri if configured
      yield* Effect.promise(() => McpOAuthCallback.ensureRunning(effectiveRedirectUri))

      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      yield* auth.updateOAuthState(mcpName, oauthState)
      let capturedUrl: URL | undefined
      const authProvider = new McpOAuthProvider(
        mcpName,
        mcpConfig.url,
        {
          clientId: oauthConfig?.clientId,
          clientSecret: oauthConfig?.clientSecret,
          scope: oauthConfig?.scope,
          redirectUri: effectiveRedirectUri,
        },
        {
          onRedirect: async (url) => {
            capturedUrl = url
          },
        },
        auth,
      )

      const transport = new StreamableHTTPClientTransport(url, {
        authProvider,
        requestInit: mcpConfig.headers ? { headers: mcpConfig.headers } : undefined,
      })
      const directory = yield* InstanceState.directory
      const cfg = yield* cfgSvc.get()
      const versionNegotiation = versionNegotiationFor(resolveProtocolMode(cfg, mcpConfig))

      return yield* Effect.tryPromise({
        try: () => {
          const client = createClient(directory, versionNegotiation)
          return client
            .connect(transport)
            .then(() => ({ authorizationUrl: "", oauthState, client }) satisfies AuthResult)
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) => {
          if (error instanceof UnauthorizedError && capturedUrl) {
            pendingOAuthTransports.set(mcpName, transport)
            return Effect.succeed({ authorizationUrl: capturedUrl.toString(), oauthState } satisfies AuthResult)
          }
          return Effect.die(error)
        }),
      )
    })

    const authenticate = Effect.fn("MCP.authenticate")(function* (
      mcpName: string,
      onAuthorization?: (authorizationUrl: string) => void,
    ) {
      const result = yield* startAuth(mcpName)
      if (!result.authorizationUrl) {
        const client = "client" in result ? result.client : undefined
        const mcpConfig = yield* requireMcpConfig(mcpName).pipe(
          Effect.tapError(() => Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)),
        )

        const listed = client
          ? client.getServerCapabilities()?.tools
            ? yield* McpCatalog.defs(client, mcpConfig.timeout)
            : []
          : undefined
        if (!client || !listed) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          return { status: "failed", error: "Failed to get tools" } satisfies Status
        }

        const s = yield* InstanceState.get(state)
        yield* auth.clearOAuthState(mcpName)
        // OAuth completion is always over a remote StreamableHTTP transport.
        const diag = diagnosticsFor(client, "StreamableHTTP")
        s.priorDiscovery[mcpName] = diag.prior
        return yield* storeClient(s, mcpName, client, listed, mcpConfig.timeout, {
          status: "connected",
          era: diag.era,
          protocolVersion: diag.protocolVersion,
          transport: diag.transport,
          capabilities: diag.capabilities,
        })
      }

      const callbackPromise = McpOAuthCallback.waitForCallback(result.oauthState, mcpName)

      onAuthorization?.(result.authorizationUrl)

      yield* Effect.tryPromise(() => open(result.authorizationUrl)).pipe(
        Effect.flatMap((subprocess) =>
          Effect.callback<void, Error>((resume) => {
            const timer = setTimeout(() => resume(Effect.void), 500)
            subprocess.on("error", (err) => {
              clearTimeout(timer)
              resume(Effect.fail(err))
            })
            subprocess.on("exit", (code) => {
              if (code !== null && code !== 0) {
                clearTimeout(timer)
                resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
              }
            })
          }),
        ),
        Effect.catch(() => {
          return events.publish(BrowserOpenFailed, { mcpName, url: result.authorizationUrl }).pipe(Effect.ignore)
        }),
      )

      const code = yield* Effect.promise(() => callbackPromise)

      const storedState = yield* auth.getOAuthState(mcpName)
      if (storedState !== result.oauthState) {
        yield* auth.clearOAuthState(mcpName)
        throw new Error("OAuth state mismatch - potential CSRF attack")
      }
      yield* auth.clearOAuthState(mcpName)
      return yield* finishAuth(mcpName, code)
    })

    const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
      yield* requireMcpConfig(mcpName)
      const transport = pendingOAuthTransports.get(mcpName)
      if (!transport) throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)

      const result = yield* Effect.tryPromise({
        try: () => transport.finishAuth(authorizationCode).then(() => true as const),
        catch: (error) => {
          return error
        },
      }).pipe(Effect.option)

      if (Option.isNone(result)) {
        return { status: "failed", error: "OAuth completion failed" } satisfies Status
      }

      yield* auth.clearCodeVerifier(mcpName)
      pendingOAuthTransports.delete(mcpName)

      const mcpConfig = yield* requireMcpConfig(mcpName)

      return yield* createAndStore(mcpName, mcpConfig)
    })

    const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
      yield* auth.remove(mcpName)
      McpOAuthCallback.cancelPending(mcpName)
      pendingOAuthTransports.delete(mcpName)
    })

    const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
      const mcpConfig = yield* requireMcpConfig(mcpName)
      return mcpConfig.type === "remote" && mcpConfig.oauth !== false
    })

    const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      return !!entry?.tokens
    })

    const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
      const entry = yield* auth.get(mcpName)
      if (!entry?.tokens) return "not_authenticated"
      // auth stores an absolute expiry; there is no isTokenExpired member.
      const expired = entry.tokens.expiresAt !== undefined && entry.tokens.expiresAt <= Date.now()
      return expired ? "expired" : "authenticated"
    })

    return Service.of({
      status,
      clients,
      instructions,
      tools,
      prompts,
      resources,
      resourceTemplates,
      add,
      connect,
      disconnect,
      getPrompt,
      readResource,
      startAuth,
      authenticate,
      finishAuth,
      removeAuth,
      supportsOAuth,
      hasStoredTokens,
      getAuthStatus,
    })
  }),
)

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

// --- Per-service runtime ---

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, McpAuth.node, EventV2Bridge.node, Config.node],
})

export * as MCP from "."
