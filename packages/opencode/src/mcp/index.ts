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
import { Effect, Layer, Scope, ServiceMap, Stream } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { NodeFileSystem } from "@effect/platform-node"
import * as NodePath from "@effect/platform-node/NodePath"

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

  // Register notification handlers for MCP client
  function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info("tools list changed notification received", { server: serverName })
      Bus.publish(ToolsChanged, { server: serverName })
    })
  }

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


  // Helper function to fetch prompts for a specific client
  async function fetchPromptsForClient(clientName: string, client: Client) {
    const prompts = await client.listPrompts().catch((e) => {
      log.error("failed to get prompts", { clientName, error: e.message })
      return undefined
    })

    if (!prompts) {
      return
    }

    const commands: Record<string, PromptInfo & { client: string }> = {}

    for (const prompt of prompts.prompts) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedPromptName

      commands[key] = { ...prompt, client: clientName }
    }
    return commands
  }

  async function fetchResourcesForClient(clientName: string, client: Client) {
    const resources = await client.listResources().catch((e) => {
      log.error("failed to get prompts", { clientName, error: e.message })
      return undefined
    })

    if (!resources) {
      return
    }

    const commands: Record<string, ResourceInfo & { client: string }> = {}

    for (const resource of resources.resources) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedResourceName = resource.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedResourceName

      commands[key] = { ...resource, client: clientName }
    }
    return commands
  }

  async function create(key: string, mcp: Config.Mcp) {
    if (mcp.enabled === false) {
      log.info("mcp server disabled", { key })
      return {
        mcpClient: undefined,
        status: { status: "disabled" as const },
      }
    }

    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
    let status: Status | undefined = undefined

    if (mcp.type === "remote") {
      // OAuth is enabled by default for remote servers unless explicitly disabled with oauth: false
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
              // Store the URL - actual browser opening is handled by startAuth
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

      let lastError: Error | undefined
      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      for (const { name, transport } of transports) {
        try {
          const client = new Client({
            name: "opencode",
            version: Installation.VERSION,
          })
          await withTimeout(client.connect(transport), connectTimeout)
          registerNotificationHandlers(client, key)
          mcpClient = client
          log.info("connected", { key, transport: name })
          status = { status: "connected" }
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          // Handle OAuth-specific errors.
          // The SDK throws UnauthorizedError when auth() returns 'REDIRECT',
          // but may also throw plain Errors when auth() fails internally
          // (e.g. during discovery, registration, or state generation).
          // When an authProvider is attached, treat both cases as auth-related.
          const isAuthError =
            error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))
          if (isAuthError) {
            log.info("mcp server requires authentication", { key, transport: name })

            // Check if this is a "needs registration" error
            if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
              status = {
                status: "needs_client_registration" as const,
                error: "Server does not support dynamic client registration. Please provide clientId in config.",
              }
              // Show toast for needs_client_registration
              Bus.publish(TuiEvent.ToastShow, {
                title: "MCP Authentication Required",
                message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                variant: "warning",
                duration: 8000,
              }).catch((e) => log.debug("failed to show toast", { error: e }))
            } else {
              // Store transport for later finishAuth call
              pendingOAuthTransports.set(key, transport)
              status = { status: "needs_auth" as const }
              // Show toast for needs_auth
              Bus.publish(TuiEvent.ToastShow, {
                title: "MCP Authentication Required",
                message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                variant: "warning",
                duration: 8000,
              }).catch((e) => log.debug("failed to show toast", { error: e }))
            }
            break
          }

          log.debug("transport connection failed", {
            key,
            transport: name,
            url: mcp.url,
            error: lastError.message,
          })
          status = {
            status: "failed" as const,
            error: lastError.message,
          }
        }
      }
    }

    if (mcp.type === "local") {
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
      try {
        const client = new Client({
          name: "opencode",
          version: Installation.VERSION,
        })
        await withTimeout(client.connect(transport), connectTimeout)
        registerNotificationHandlers(client, key)
        mcpClient = client
        status = {
          status: "connected",
        }
      } catch (error) {
        log.error("local mcp startup failed", {
          key,
          command: mcp.command,
          cwd,
          error: error instanceof Error ? error.message : String(error),
        })
        status = {
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    if (!status) {
      status = {
        status: "failed" as const,
        error: "Unknown error",
      }
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        status,
      }
    }

    const result = await withTimeout(mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return undefined
    })
    if (!result) {
      await mcpClient.close().catch((error) => {
        log.error("Failed to close MCP client", {
          error,
        })
      })
      status = {
        status: "failed",
        error: "Failed to get tools",
      }
      return {
        mcpClient: undefined,
        status: {
          status: "failed" as const,
          error: "Failed to get tools",
        },
      }
    }

    log.info("create() successfully created client", { key, toolCount: result.tools.length })
    return {
      mcpClient,
      status,
    }
  }

  // --- Effect Service ---

  interface State {
    status: Record<string, Status>
    clients: Record<string, MCPClient>
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
    readonly startAuth: (mcpName: string) => Effect.Effect<{ authorizationUrl: string }>
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
      const scope = yield* Scope.Scope
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const auth = yield* McpAuth.Service

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

      const cache = yield* InstanceState.make<State>(
        Effect.fn("MCP.state")(function* () {
          const cfg = yield* Effect.promise(() => Config.get())
          const config = cfg.mcp ?? {}
          const clients: Record<string, MCPClient> = {}
          const statusMap: Record<string, Status> = {}

          yield* Effect.forEach(
            Object.entries(config),
            ([key, mcp]) =>
              Effect.gen(function* () {
                if (!isMcpConfigured(mcp)) {
                  log.error("Ignoring MCP config entry without type", { key })
                  return
                }

                if (mcp.enabled === false) {
                  statusMap[key] = { status: "disabled" }
                  return
                }

                const result = yield* Effect.promise(() => create(key, mcp).catch(() => undefined))
                if (!result) return

                statusMap[key] = result.status
                if (result.mcpClient) {
                  clients[key] = result.mcpClient
                }
              }),
            { concurrency: "unbounded" },
          )

          const s: State = { status: statusMap, clients }

          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              yield* Effect.forEach(
                Object.values(s.clients),
                (client) =>
                  Effect.gen(function* () {
                    const pid = (client.transport as any)?.pid
                    if (typeof pid === "number") {
                      const pids = yield* descendants(pid)
                      yield* Effect.forEach(pids, (dpid) =>
                        Effect.try({
                          try: () => process.kill(dpid, "SIGTERM"),
                          catch: () => new Error(`failed to kill ${dpid}`),
                        }).pipe(Effect.ignore),
                      )
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
        if (!client) return Effect.void
        return Effect.tryPromise({
          try: () => client.close(),
          catch: (error) => {
            log.error("failed to close MCP client", { name, error })
            return error
          },
        }).pipe(Effect.ignore)
      }

      const status = Effect.fn("MCP.status")(function* () {
        const s = yield* InstanceState.get(cache)
        const cfg = yield* Effect.promise(() => Config.get())
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
        const result = yield* Effect.promise(() => create(name, mcp))
        const s = yield* InstanceState.get(cache)

        if (!result) {
          s.status[name] = { status: "failed" as const, error: "unknown error" }
          return s.status[name]
        }

        s.status[name] = result.status
        if (result.mcpClient) {
          yield* closeClient(s, name)
          s.clients[name] = result.mcpClient
        }
        return result.status
      })

      const add = Effect.fn("MCP.add")(function* (name: string, mcp: Config.Mcp) {
        yield* createAndStore(name, mcp)
        const s = yield* InstanceState.get(cache)
        return { status: s.status }
      })

      const connect = Effect.fn("MCP.connect")(function* (name: string) {
        const cfg = yield* Effect.promise(() => Config.get())
        const config = cfg.mcp ?? {}
        const mcp = config[name]
        if (!mcp) {
          log.error("MCP config not found", { name })
          return
        }
        if (!isMcpConfigured(mcp)) {
          log.error("Ignoring MCP connect request for config without type", { name })
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
        const cfg = yield* Effect.promise(() => Config.get())
        const config = cfg.mcp ?? {}
        const defaultTimeout = cfg.experimental?.mcp_timeout

        const connectedClients = Object.entries(s.clients).filter(
          ([clientName]) => s.status[clientName]?.status === "connected",
        )

        yield* Effect.forEach(
          connectedClients,
          ([clientName, client]) =>
            Effect.gen(function* () {
              const toolsResult = yield* Effect.tryPromise({
                try: () => client.listTools(),
                catch: (e: any) => {
                  log.error("failed to get tools", { clientName, error: e?.message })
                  s.status[clientName] = {
                    status: "failed" as const,
                    error: e instanceof Error ? e.message : String(e),
                  }
                  delete s.clients[clientName]
                  return e
                },
              }).pipe(Effect.option)

              if (toolsResult._tag === "None") {
                // Fork background reconnection — tools come back next turn
                const mcpConfig = config[clientName]
                if (mcpConfig && isMcpConfigured(mcpConfig)) {
                  yield* createAndStore(clientName, mcpConfig).pipe(
                    Effect.catch(() => Effect.void),
                    Effect.forkIn(scope),
                  )
                }
                return
              }

              const mcpConfig = config[clientName]
              const entry = isMcpConfigured(mcpConfig) ? mcpConfig : undefined
              const timeout = entry?.timeout ?? defaultTimeout
              for (const mcpTool of toolsResult.value.tools) {
                const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
                const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
                result[sanitizedClientName + "_" + sanitizedToolName] = convertMcpTool(mcpTool, client, timeout)
              }
            }),
          { concurrency: "unbounded" },
        )
        return result
      })

      function collectFromConnected<T>(
        s: State,
        fetchFn: (clientName: string, client: Client) => Promise<Record<string, T> | undefined>,
      ) {
        return Effect.forEach(
          Object.entries(s.clients).filter(([name]) => s.status[name]?.status === "connected"),
          ([clientName, client]) =>
            Effect.promise(async () => Object.entries((await fetchFn(clientName, client)) ?? {})),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((results) => Object.fromEntries<T>(results.flat())))
      }

      const prompts = Effect.fn("MCP.prompts")(function* () {
        const s = yield* InstanceState.get(cache)
        return yield* collectFromConnected(s, fetchPromptsForClient)
      })

      const resources = Effect.fn("MCP.resources")(function* () {
        const s = yield* InstanceState.get(cache)
        return yield* collectFromConnected(s, fetchResourcesForClient)
      })

      function withClient<A>(
        clientName: string,
        fn: (client: MCPClient) => Promise<A>,
        label: string,
        meta?: Record<string, unknown>,
      ) {
        return Effect.gen(function* () {
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
      }

      const getPrompt = Effect.fn("MCP.getPrompt")(function* (
        clientName: string,
        name: string,
        args?: Record<string, string>,
      ) {
        return yield* withClient(
          clientName,
          (client) => client.getPrompt({ name, arguments: args }),
          "getPrompt",
          { promptName: name },
        )
      })

      const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
        return yield* withClient(
          clientName,
          (client) => client.readResource({ uri: resourceUri }),
          "readResource",
          { resourceUri },
        )
      })

      function getMcpConfig(mcpName: string) {
        return Effect.gen(function* () {
          const cfg = yield* Effect.promise(() => Config.get())
          const mcpConfig = cfg.mcp?.[mcpName]
          if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
          return mcpConfig
        })
      }

      const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) throw new Error(`MCP server ${mcpName} not found or disabled`)
        if (mcpConfig.type !== "remote") throw new Error(`MCP server ${mcpName} is not a remote server`)
        if (mcpConfig.oauth === false) throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)

        yield* Effect.promise(() => McpOAuthCallback.ensureRunning())

        const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
        yield* auth.updateOAuthState(mcpName, oauthState).pipe(Effect.orDie)

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
          { onRedirect: async (url) => { capturedUrl = url } },
        )

        const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), { authProvider })

        return yield* Effect.promise(async () => {
          try {
            const client = new Client({ name: "opencode", version: Installation.VERSION })
            await client.connect(transport)
            return { authorizationUrl: "" }
          } catch (error) {
            if (error instanceof UnauthorizedError && capturedUrl) {
              pendingOAuthTransports.set(mcpName, transport)
              return { authorizationUrl: capturedUrl.toString() }
            }
            throw error
          }
        })
      })

      const authenticate = Effect.fn("MCP.authenticate")(function* (mcpName: string) {
        const { authorizationUrl } = yield* startAuth(mcpName)
        if (!authorizationUrl) return { status: "connected" } as Status

        const oauthState = yield* auth.getOAuthState(mcpName).pipe(Effect.orDie)
        if (!oauthState) throw new Error("OAuth state not found - this should not happen")

        log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

        const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

        yield* Effect.tryPromise(() => open(authorizationUrl)).pipe(
          Effect.flatMap((subprocess) =>
            Effect.tryPromise(
              () =>
                new Promise<void>((resolve, reject) => {
                  const timeout = setTimeout(() => resolve(), 500)
                  subprocess.on("error", (error) => { clearTimeout(timeout); reject(error) })
                  subprocess.on("exit", (code) => {
                    if (code !== null && code !== 0) { clearTimeout(timeout); reject(new Error(`Browser open failed with exit code ${code}`)) }
                  })
                }),
            ),
          ),
          Effect.catch(() => {
            log.warn("failed to open browser, user must open URL manually", { mcpName })
            return Effect.promise(() => Bus.publish(BrowserOpenFailed, { mcpName, url: authorizationUrl }))
          }),
        )

        const code = yield* Effect.promise(() => callbackPromise)

        const storedState = yield* auth.getOAuthState(mcpName).pipe(Effect.orDie)
        if (storedState !== oauthState) {
          yield* auth.clearOAuthState(mcpName).pipe(Effect.orDie)
          throw new Error("OAuth state mismatch - potential CSRF attack")
        }
        yield* auth.clearOAuthState(mcpName).pipe(Effect.orDie)

        return yield* finishAuth(mcpName, code)
      })

      const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
        const transport = pendingOAuthTransports.get(mcpName)
        if (!transport) throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)

        const result = yield* Effect.tryPromise({
          try: async () => {
            await transport.finishAuth(authorizationCode)
            return true
          },
          catch: (error) => {
            log.error("failed to finish oauth", { mcpName, error })
            return error
          },
        }).pipe(Effect.option)

        if (result._tag === "None") {
          return { status: "failed", error: "OAuth completion failed" } as Status
        }

        yield* auth.clearCodeVerifier(mcpName).pipe(Effect.orDie)
        pendingOAuthTransports.delete(mcpName)

        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) return { status: "failed", error: "MCP config not found after auth" } as Status

        return yield* createAndStore(mcpName, mcpConfig)
      })

      const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
        yield* auth.remove(mcpName).pipe(Effect.orDie)
        McpOAuthCallback.cancelPending(mcpName)
        pendingOAuthTransports.delete(mcpName)
        yield* auth.clearOAuthState(mcpName).pipe(Effect.orDie)
        log.info("removed oauth credentials", { mcpName })
      })

      const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) return false
        return mcpConfig.type === "remote" && mcpConfig.oauth !== false
      })

      const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
        const entry = yield* auth.get(mcpName).pipe(Effect.orDie)
        return !!entry?.tokens
      })

      const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
        const entry = yield* auth.get(mcpName).pipe(Effect.orDie)
        if (!entry?.tokens) return "not_authenticated" as AuthStatus
        const expired = yield* auth.isTokenExpired(mcpName).pipe(Effect.orDie)
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

  const defaultLayer = layer.pipe(
    Layer.provide(McpAuth.layer),
    Layer.provide(CrossSpawnSpawner.layer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  )

  const runPromise = makeRunPromise(Service, defaultLayer)

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
