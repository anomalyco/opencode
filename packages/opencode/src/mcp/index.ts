import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod/v4"
import { Instance } from "../project/instance"
import { Installation } from "../installation"
import { withTimeout } from "@/util/timeout"
import { AppFileSystem } from "@/filesystem"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import open from "open"
import { Effect, Exit, Layer, Option, ServiceMap, Stream } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000

  export const Resource = z
    .object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      client: z.string(),
    })
    .meta({ ref: "McpResource" })
  export type Resource = z.infer<typeof Resource>

  export const ToolsChanged = BusEvent.define(
    "mcp.tools.changed",
    z.object({
      server: z.string(),
    }),
  )

  export const BrowserOpenFailed = BusEvent.define(
    "mcp.browser.open.failed",
    z.object({
      mcpName: z.string(),
      url: z.string(),
    }),
  )

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  type MCPClient = Client

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({
          ref: "MCPStatusNeedsAuth",
        }),
      z
        .object({
          status: z.literal("needs_client_registration"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusNeedsClientRegistration",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  // Store transports for OAuth servers to allow finishing auth
  type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
  const pendingOAuthTransports = new Map<string, TransportWithAuth>()

  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]

  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }

  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

  // Convert MCP tool definition to AI SDK Tool type
  function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Tool {
    const inputSchema = mcpTool.inputSchema

    // Spread first, then override type to ensure it's always "object"
    const schema: JSONSchema7 = {
      ...(inputSchema as JSONSchema7),
      type: "object",
      properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }

    return dynamicTool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        return client.callTool(
          {
            name: mcpTool.name,
            arguments: (args || {}) as Record<string, unknown>,
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            timeout,
          },
        )
      },
    })
  }

  function defs(key: string, client: MCPClient, timeout?: number) {
    return Effect.tryPromise({
      try: () => withTimeout(client.listTools(), timeout ?? DEFAULT_TIMEOUT),
      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
    }).pipe(
      Effect.map((result) => result.tools),
      Effect.catch((err) => {
        log.error("failed to get tools from client", { key, error: err })
        return Effect.succeed(undefined)
      }),
    )
  }

  function fetchFromClient<T extends { name: string }>(
    clientName: string,
    client: Client,
    listFn: (c: Client) => Promise<T[]>,
    label: string,
  ) {
    return Effect.tryPromise({
      try: () => listFn(client),
      catch: (e: any) => {
        log.error(`failed to get ${label}`, { clientName, error: e.message })
        return e
      },
    }).pipe(
      Effect.map((items) => {
        const out: Record<string, T & { client: string }> = {}
        const sanitizedClient = sanitize(clientName)
        for (const item of items) {
          out[sanitizedClient + ":" + sanitize(item.name)] = { ...item, client: clientName }
        }
        return out
      }),
      Effect.orElseSucceed(() => undefined),
    )
  }

  interface CreateResult {
    mcpClient?: MCPClient
    status: Status
    defs?: MCPToolDef[]
  }

  // --- Effect Service ---

  interface State {
    status: Record<string, Status>
    clients: Record<string, MCPClient>
    defs: Record<string, MCPToolDef[]>
  }

  export interface Interface {
    readonly status: () => Effect.Effect<Record<string, Status>>
    readonly clients: () => Effect.Effect<Record<string, MCPClient>>
    readonly tools: () => Effect.Effect<Record<string, Tool>>
    readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
    readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
    readonly add: (name: string, mcp: Config.Mcp) => Effect.Effect<{ status: Record<string, Status> | Status }>
    readonly connect: (name: string) => Effect.Effect<void>
    readonly disconnect: (name: string) => Effect.Effect<void>
    readonly getPrompt: (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
    readonly readResource: (
      clientName: string,
      resourceUri: string,
    ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
    readonly startAuth: (mcpName: string) => Effect.Effect<{ authorizationUrl: string; oauthState: string }>
    readonly authenticate: (mcpName: string) => Effect.Effect<Status>
    readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status>
    readonly removeAuth: (mcpName: string) => Effect.Effect<void>
    readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean>
    readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
    readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/MCP") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const auth = yield* McpAuth.Service
      const bus = yield* Bus.Service

      type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

      /**
       * Connect a client via the given transport with resource safety:
       * on failure the transport is closed; on success the caller owns it.
       */
      const connectTransport = (transport: Transport, timeout: number) =>
        Effect.acquireUseRelease(
          Effect.succeed(transport),
          (t) =>
            Effect.tryPromise({
              try: () => {
                const client = new Client({ name: "opencode", version: Installation.VERSION })
                return withTimeout(client.connect(t), timeout).then(() => client)
              },
              catch: (e) => (e instanceof Error ? e : new Error(String(e))),
            }),
          (t, exit) => (Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void),
        )

      const DISABLED_RESULT: CreateResult = { status: { status: "disabled" } }

      const connectRemote = Effect.fn("MCP.connectRemote")(function* (
        key: string,
        mcp: Config.Mcp & { type: "remote" },
      ) {
        const oauthDisabled = mcp.oauth === false
        const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
        let authProvider: McpOAuthProvider | undefined

        if (!oauthDisabled) {
          authProvider = new McpOAuthProvider(
            key,
            mcp.url,
            {
              clientId: oauthConfig?.clientId,
              clientSecret: oauthConfig?.clientSecret,
              scope: oauthConfig?.scope,
            },
            {
              onRedirect: async (url) => {
                log.info("oauth redirect requested", { key, url: url.toString() })
              },
            },
          )
        }

        const transports: Array<{ name: string; transport: TransportWithAuth }> = [
          {
            name: "StreamableHTTP",
            transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
              authProvider,
              requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
            }),
          },
          {
            name: "SSE",
            transport: new SSEClientTransport(new URL(mcp.url), {
              authProvider,
              requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
            }),
          },
        ]

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        let lastStatus: Status | undefined

        for (const { name, transport } of transports) {
          const result = yield* connectTransport(transport, connectTimeout).pipe(
            Effect.map((client) => ({ client, transportName: name })),
            Effect.catch((error) => {
              const lastError = error instanceof Error ? error : new Error(String(error))
              const isAuthError =
                error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

              if (isAuthError) {
                log.info("mcp server requires authentication", { key, transport: name })

                if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                  lastStatus = {
                    status: "needs_client_registration" as const,
                    error: "Server does not support dynamic client registration. Please provide clientId in config.",
                  }
                  return bus
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
                  return bus
                    .publish(TuiEvent.ToastShow, {
                      title: "MCP Authentication Required",
                      message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                      variant: "warning",
                      duration: 8000,
                    })
                    .pipe(Effect.ignore, Effect.as(undefined))
                }
              }

              log.debug("transport connection failed", {
                key,
                transport: name,
                url: mcp.url,
                error: lastError.message,
              })
              lastStatus = { status: "failed" as const, error: lastError.message }
              return Effect.succeed(undefined)
            }),
          )
          if (result) {
            log.info("connected", { key, transport: result.transportName })
            return { client: result.client as MCPClient | undefined, status: { status: "connected" } as Status }
          }
          // If this was an auth error, stop trying other transports
          if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
        }

        return {
          client: undefined as MCPClient | undefined,
          status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
        }
      })

      const connectLocal = Effect.fn("MCP.connectLocal")(function* (key: string, mcp: Config.Mcp & { type: "local" }) {
        const [cmd, ...args] = mcp.command
        const cwd = Instance.directory
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
        transport.stderr?.on("data", (chunk: Buffer) => {
          log.info(`mcp stderr: ${chunk.toString()}`, { key })
        })

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        return yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map((client): { client: MCPClient | undefined; status: Status } => ({
            client,
            status: { status: "connected" },
          })),
          Effect.catch((error): Effect.Effect<{ client: MCPClient | undefined; status: Status }> => {
            const msg = error instanceof Error ? error.message : String(error)
            log.error("local mcp startup failed", { key, command: mcp.command, cwd, error: msg })
            return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
          }),
        )
      })

      const create = Effect.fn("MCP.create")(function* (key: string, mcp: Config.Mcp) {
        if (mcp.enabled === false) {
          log.info("mcp server disabled", { key })
          return DISABLED_RESULT
        }

        log.info("found", { key, type: mcp.type })

        const { client: mcpClient, status } =
          mcp.type === "remote"
            ? yield* connectRemote(key, mcp as Config.Mcp & { type: "remote" })
            : yield* connectLocal(key, mcp as Config.Mcp & { type: "local" })

        if (!mcpClient) {
          return { status } satisfies CreateResult
        }

        const listed = yield* defs(key, mcpClient, mcp.timeout)
        if (!listed) {
          yield* Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore)
          return { status: { status: "failed", error: "Failed to get tools" } } satisfies CreateResult
        }

        log.info("create() successfully created client", { key, toolCount: listed.length })
        return { mcpClient, status, defs: listed } satisfies CreateResult
      })
      const cfgSvc = yield* Config.Service

      const descendants = Effect.fnUntraced(
        function* (pid: number) {
          if (process.platform === "win32") return [] as number[]
          const pids: number[] = []
          const queue = [pid]
          while (queue.length > 0) {
            const current = queue.shift()!
            const handle = yield* spawner.spawn(
              ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }),
            )
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

      function watch(s: State, name: string, client: MCPClient, timeout?: number) {
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          log.info("tools list changed notification received", { server: name })
          if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

          const listed = await Effect.runPromise(defs(name, client, timeout))
          if (!listed) return
          if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

          s.defs[name] = listed
          await Effect.runPromise(bus.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
        })
      }

      const cache = yield* InstanceState.make<State>(
        Effect.fn("MCP.state")(function* () {
          const cfg = yield* cfgSvc.get()
          const config = cfg.mcp ?? {}
          const s: State = {
            status: {},
            clients: {},
            defs: {},
          }

          yield* Effect.forEach(
            Object.entries(config),
            ([key, mcp]) =>
              Effect.gen(function* () {
                if (!isMcpConfigured(mcp)) {
                  log.error("Ignoring MCP config entry without type", { key })
                  return
                }

                if (mcp.enabled === false) {
                  s.status[key] = { status: "disabled" }
                  return
                }

                const result = yield* create(key, mcp).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (!result) return

                s.status[key] = result.status
                if (result.mcpClient) {
                  s.clients[key] = result.mcpClient
                  s.defs[key] = result.defs!
                  watch(s, key, result.mcpClient, mcp.timeout)
                }
              }),
            { concurrency: "unbounded" },
          )

          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              yield* Effect.forEach(
                Object.values(s.clients),
                (client) =>
                  Effect.gen(function* () {
                    const pid = (client.transport as any)?.pid
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
        delete s.defs[name]
        if (!client) return Effect.void
        return Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
      }

      const status = Effect.fn("MCP.status")(function* () {
        const s = yield* InstanceState.get(cache)

        const cfg = yield* cfgSvc.get()
        const config = cfg.mcp ?? {}
        const result: Record<string, Status> = {}

        for (const [key, mcp] of Object.entries(config)) {
          if (!isMcpConfigured(mcp)) continue
          result[key] = s.status[key] ?? { status: "disabled" }
        }

        return result
      })

      const clients = Effect.fn("MCP.clients")(function* () {
        const s = yield* InstanceState.get(cache)
        return s.clients
      })

      const createAndStore = Effect.fn("MCP.createAndStore")(function* (name: string, mcp: Config.Mcp) {
        const s = yield* InstanceState.get(cache)
        const result = yield* create(name, mcp)

        s.status[name] = result.status
        if (!result.mcpClient) {
          yield* closeClient(s, name)
          delete s.clients[name]
          return result.status
        }

        yield* closeClient(s, name)
        s.clients[name] = result.mcpClient
        s.defs[name] = result.defs!
        watch(s, name, result.mcpClient, mcp.timeout)
        return result.status
      })

      const add = Effect.fn("MCP.add")(function* (name: string, mcp: Config.Mcp) {
        yield* createAndStore(name, mcp)
        const s = yield* InstanceState.get(cache)
        return { status: s.status }
      })

      const connect = Effect.fn("MCP.connect")(function* (name: string) {
        const mcp = yield* getMcpConfig(name)
        if (!mcp) {
          log.error("MCP config not found or invalid", { name })
          return
        }
        yield* createAndStore(name, { ...mcp, enabled: true })
      })

      const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
        const s = yield* InstanceState.get(cache)
        yield* closeClient(s, name)
        delete s.clients[name]
        s.status[name] = { status: "disabled" }
      })

      const tools = Effect.fn("MCP.tools")(function* () {
        const result: Record<string, Tool> = {}
        const s = yield* InstanceState.get(cache)

        const cfg = yield* cfgSvc.get()
        const config = cfg.mcp ?? {}
        const defaultTimeout = cfg.experimental?.mcp_timeout

        const connectedClients = Object.entries(s.clients).filter(
          ([clientName]) => s.status[clientName]?.status === "connected",
        )

        yield* Effect.forEach(
          connectedClients,
          ([clientName, client]) =>
            Effect.gen(function* () {
              const mcpConfig = config[clientName]
              const entry = mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig : undefined

              const listed = s.defs[clientName]
              if (!listed) {
                log.warn("missing cached tools for connected server", { clientName })
                return
              }

              const timeout = entry?.timeout ?? defaultTimeout
              for (const mcpTool of listed) {
                result[sanitize(clientName) + "_" + sanitize(mcpTool.name)] = convertMcpTool(mcpTool, client, timeout)
              }
            }),
          { concurrency: "unbounded" },
        )
        return result
      })

      function collectFromConnected<T extends { name: string }>(
        s: State,
        listFn: (c: Client) => Promise<T[]>,
        label: string,
      ) {
        return Effect.forEach(
          Object.entries(s.clients).filter(([name]) => s.status[name]?.status === "connected"),
          ([clientName, client]) =>
            fetchFromClient(clientName, client, listFn, label).pipe(Effect.map((items) => Object.entries(items ?? {}))),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
      }

      const prompts = Effect.fn("MCP.prompts")(function* () {
        const s = yield* InstanceState.get(cache)
        return yield* collectFromConnected(s, (c) => c.listPrompts().then((r) => r.prompts), "prompts")
      })

      const resources = Effect.fn("MCP.resources")(function* () {
        const s = yield* InstanceState.get(cache)
        return yield* collectFromConnected(s, (c) => c.listResources().then((r) => r.resources), "resources")
      })

      const withClient = Effect.fnUntraced(function* <A>(
        clientName: string,
        fn: (client: MCPClient) => Promise<A>,
        label: string,
        meta?: Record<string, unknown>,
      ) {
        const s = yield* InstanceState.get(cache)
        const client = s.clients[clientName]
        if (!client) {
          log.warn(`client not found for ${label}`, { clientName })
          return undefined
        }
        return yield* Effect.tryPromise({
          try: () => fn(client),
          catch: (e: any) => {
            log.error(`failed to ${label}`, { clientName, ...meta, error: e?.message })
            return e
          },
        }).pipe(Effect.orElseSucceed(() => undefined))
      })

      const getPrompt = Effect.fn("MCP.getPrompt")(function* (
        clientName: string,
        name: string,
        args?: Record<string, string>,
      ) {
        return yield* withClient(clientName, (client) => client.getPrompt({ name, arguments: args }), "getPrompt", {
          promptName: name,
        })
      })

      const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
        return yield* withClient(clientName, (client) => client.readResource({ uri: resourceUri }), "readResource", {
          resourceUri,
        })
      })

      const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
        const cfg = yield* cfgSvc.get()
        const mcpConfig = cfg.mcp?.[mcpName]
        if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
        return mcpConfig
      })

      const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) throw new Error(`MCP server ${mcpName} not found or disabled`)
        if (mcpConfig.type !== "remote") throw new Error(`MCP server ${mcpName} is not a remote server`)
        if (mcpConfig.oauth === false) throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)

        yield* Effect.promise(() => McpOAuthCallback.ensureRunning())

        const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
        yield* auth.updateOAuthState(mcpName, oauthState)
        const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
        let capturedUrl: URL | undefined
        const authProvider = new McpOAuthProvider(
          mcpName,
          mcpConfig.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
          },
          {
            onRedirect: async (url) => {
              capturedUrl = url
            },
          },
        )

        const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), { authProvider })

        return yield* Effect.tryPromise({
          try: () => {
            const client = new Client({ name: "opencode", version: Installation.VERSION })
            return client.connect(transport).then(() => ({ authorizationUrl: "", oauthState }))
          },
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) => {
            if (error instanceof UnauthorizedError && capturedUrl) {
              pendingOAuthTransports.set(mcpName, transport)
              return Effect.succeed({ authorizationUrl: capturedUrl.toString(), oauthState })
            }
            return Effect.die(error)
          }),
        )
      })

      const authenticate = Effect.fn("MCP.authenticate")(function* (mcpName: string) {
        const { authorizationUrl, oauthState } = yield* startAuth(mcpName)
        if (!authorizationUrl) return { status: "connected" } as Status

        log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

        const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

        yield* Effect.tryPromise(() => open(authorizationUrl)).pipe(
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
            log.warn("failed to open browser, user must open URL manually", { mcpName })
            return bus.publish(BrowserOpenFailed, { mcpName, url: authorizationUrl }).pipe(Effect.ignore)
          }),
        )

        const code = yield* Effect.promise(() => callbackPromise)

        const storedState = yield* auth.getOAuthState(mcpName)
        if (storedState !== oauthState) {
          yield* auth.clearOAuthState(mcpName)
          throw new Error("OAuth state mismatch - potential CSRF attack")
        }
        yield* auth.clearOAuthState(mcpName)
        return yield* finishAuth(mcpName, code)
      })

      const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
        const transport = pendingOAuthTransports.get(mcpName)
        if (!transport) throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)

        const result = yield* Effect.tryPromise({
          try: () => transport.finishAuth(authorizationCode).then(() => true as const),
          catch: (error) => {
            log.error("failed to finish oauth", { mcpName, error })
            return error
          },
        }).pipe(Effect.option)

        if (Option.isNone(result)) {
          return { status: "failed", error: "OAuth completion failed" } as Status
        }

        yield* auth.clearCodeVerifier(mcpName)
        pendingOAuthTransports.delete(mcpName)

        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) return { status: "failed", error: "MCP config not found after auth" } as Status

        return yield* createAndStore(mcpName, mcpConfig)
      })

      const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
        yield* auth.remove(mcpName)
        McpOAuthCallback.cancelPending(mcpName)
        pendingOAuthTransports.delete(mcpName)
        log.info("removed oauth credentials", { mcpName })
      })

      const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) return false
        return mcpConfig.type === "remote" && mcpConfig.oauth !== false
      })

      const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
        const entry = yield* auth.get(mcpName)
        return !!entry?.tokens
      })

      const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
        const entry = yield* auth.get(mcpName)
        if (!entry?.tokens) return "not_authenticated" as AuthStatus
        const expired = yield* auth.isTokenExpired(mcpName)
        return (expired ? "expired" : "authenticated") as AuthStatus
      })

      return Service.of({
        status,
        clients,
        tools,
        prompts,
        resources,
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

  export const defaultLayer = layer.pipe(
    Layer.provide(McpAuth.layer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  // --- Async facade functions ---

  export const status = async () => runPromise((svc) => svc.status())

  export const clients = async () => runPromise((svc) => svc.clients())

  export const tools = async () => runPromise((svc) => svc.tools())

  export const prompts = async () => runPromise((svc) => svc.prompts())

  export const resources = async () => runPromise((svc) => svc.resources())

  export const add = async (name: string, mcp: Config.Mcp) => runPromise((svc) => svc.add(name, mcp))

  export const connect = async (name: string) => runPromise((svc) => svc.connect(name))

  export const disconnect = async (name: string) => runPromise((svc) => svc.disconnect(name))

  export const getPrompt = async (clientName: string, name: string, args?: Record<string, string>) =>
    runPromise((svc) => svc.getPrompt(clientName, name, args))

  export const readResource = async (clientName: string, resourceUri: string) =>
    runPromise((svc) => svc.readResource(clientName, resourceUri))

  export const startAuth = async (mcpName: string) => runPromise((svc) => svc.startAuth(mcpName))

  export const authenticate = async (mcpName: string) => runPromise((svc) => svc.authenticate(mcpName))

  export const finishAuth = async (mcpName: string, authorizationCode: string) =>
    runPromise((svc) => svc.finishAuth(mcpName, authorizationCode))

  export const removeAuth = async (mcpName: string) => runPromise((svc) => svc.removeAuth(mcpName))

  export const supportsOAuth = async (mcpName: string) => runPromise((svc) => svc.supportsOAuth(mcpName))

  export const hasStoredTokens = async (mcpName: string) => runPromise((svc) => svc.hasStoredTokens(mcpName))

  export const getAuthStatus = async (mcpName: string) => runPromise((svc) => svc.getAuthStatus(mcpName))
}
