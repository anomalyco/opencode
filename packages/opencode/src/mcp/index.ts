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
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { McpSanitize } from "./sanitize"
import { Crypto } from "../util/crypto"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Scheduler } from "../scheduler"
import open from "open"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000
  const RECONNECT_BASE = 30_000
  const RECONNECT_MAX = 5 * 60_000
  const ENV_WHITELIST = new Set([
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "TERM",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "EDITOR",
    "VISUAL",
    "PAGER",
    "LESS",
    "COLORTERM",
    "FORCE_COLOR",
    "NO_COLOR",
    "TERM_PROGRAM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_RUNTIME_DIR",
    "NODE_ENV",
    "BUN_INSTALL",
    "npm_config_registry",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "SSH_AUTH_SOCK",
    "GPG_TTY",
  ])

  // Per-name mutex to prevent race conditions on add/connect/disconnect
  const locks = new Map<string, Promise<unknown>>()
  async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(name) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    locks.set(name, next)
    try {
      return await next
    } finally {
      if (locks.get(name) === next) locks.delete(name)
    }
  }

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

  // Register notification handlers for MCP client
  function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info("tools list changed notification received", { server: serverName })
      Bus.publish(ToolsChanged, { server: serverName })
    })
  }

  // Convert MCP tool definition to AI SDK Tool type
  async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Promise<Tool> {
    const inputSchema = mcpTool.inputSchema

    // Spread first, then override type to ensure it's always "object"
    const schema: JSONSchema7 = {
      ...(inputSchema as JSONSchema7),
      type: "object",
      properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }

    return dynamicTool({
      description: McpSanitize.escapeInjectionPatterns(mcpTool.description ?? ""),
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        const response = await client.callTool(
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
        return McpSanitize.sanitizeToolResponse(response)
      },
    })
  }

  // Store transports for OAuth servers to allow finishing auth
  type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
  const pendingOAuthTransports = new Map<string, TransportWithAuth>()
  const reconnectState = new Map<string, { attempt: number; nextAt: number }>()

  function getSafeEnv(): Record<string, string> {
    const safeEnv: Record<string, string> = {}
    for (const key of ENV_WHITELIST) {
      const value = process.env[key]
      if (value) safeEnv[key] = value
    }
    return safeEnv
  }

  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]

  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]
  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }

  const state = Instance.state(
    async () => {
      const cfg = await Config.get()
      const config = cfg.mcp ?? {}
      const clients: Record<string, MCPClient> = {}
      const status: Record<string, Status> = {}

      await Promise.all(
        Object.entries(config).map(async ([key, mcp]) => {
          if (!isMcpConfigured(mcp)) {
            log.error("Ignoring MCP config entry without type", { key })
            return
          }

          // If disabled by config, mark as disabled without trying to connect
          if (mcp.enabled === false) {
            status[key] = { status: "disabled" }
            return
          }

          const result = await create(key, mcp).catch(() => undefined)
          if (!result) return

          status[key] = result.status

          if (result.mcpClient) {
            clients[key] = result.mcpClient
          }
        }),
      )
      return {
        status,
        clients,
      }
    },
    async (state) => {
      await Promise.all(
        Object.values(state.clients).map((client) =>
          client.close().catch((error) => {
            log.error("Failed to close MCP client", {
              error,
            })
          }),
        ),
      )
      pendingOAuthTransports.clear()
      await McpOAuthCallback.stop()
    },
  )

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
      log.error("failed to get resources", { clientName, error: e.message })
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

  export async function add(name: string, mcp: Config.Mcp) {
    return withLock(name, async () => {
      const s = await state()
      const result = await create(name, mcp)
      if (!result) {
        const status = {
          status: "failed" as const,
          error: "unknown error",
        }
        s.status[name] = status
        return {
          status,
        }
      }
      if (!result.mcpClient) {
        s.status[name] = result.status
        return {
          status: s.status,
        }
      }
      // Close existing client if present to prevent memory leaks
      const existingClient = s.clients[name]
      if (existingClient) {
        await existingClient.close().catch((error) => {
          log.error("Failed to close existing MCP client", { name, error })
        })
      }
      s.clients[name] = result.mcpClient
      s.status[name] = result.status

      return {
        status: s.status,
      }
    })
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

          // Handle OAuth-specific errors
          if (error instanceof UnauthorizedError) {
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
          ...getSafeEnv(),
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

  export async function status() {
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const result: Record<string, Status> = {}

    // Include all configured MCPs from config, not just connected ones
    for (const [key, mcp] of Object.entries(config)) {
      if (!isMcpConfigured(mcp)) continue
      result[key] = s.status[key] ?? { status: "disabled" }
    }

    return result
  }

  export async function clients() {
    return state().then((state) => state.clients)
  }

  export async function connect(name: string) {
    return withLock(name, async () => {
      const cfg = await Config.get()
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

      const result = await create(name, { ...mcp, enabled: true })

      if (!result) {
        const s = await state()
        s.status[name] = {
          status: "failed",
          error: "Unknown error during connection",
        }
        return
      }

      const s = await state()
      s.status[name] = result.status
      if (result.mcpClient) {
        // Close existing client if present to prevent memory leaks
        const existingClient = s.clients[name]
        if (existingClient) {
          await existingClient.close().catch((error) => {
            log.error("Failed to close existing MCP client", { name, error })
          })
        }
        s.clients[name] = result.mcpClient
      }
    })
  }

  export async function disconnect(name: string) {
    return withLock(name, async () => {
      const s = await state()
      const client = s.clients[name]
      if (client) {
        await client.close().catch((error) => {
          log.error("Failed to close MCP client", { name, error })
        })
        delete s.clients[name]
      }
      s.status[name] = { status: "disabled" }
    })
  }

  export async function tools() {
    const result: Record<string, Tool> = {}
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const clientsSnapshot = await clients()
    const defaultTimeout = cfg.experimental?.mcp_timeout

    for (const [clientName, client] of Object.entries(clientsSnapshot)) {
      // Only include tools from connected MCPs (skip disabled ones)
      if (s.status[clientName]?.status !== "connected") {
        continue
      }

      const toolsResult = await client.listTools().catch((e) => {
        log.error("failed to get tools", { clientName, error: e.message })
        const failedStatus = {
          status: "failed" as const,
          error: e instanceof Error ? e.message : String(e),
        }
        s.status[clientName] = failedStatus
        delete s.clients[clientName]
        return undefined
      })
      if (!toolsResult) {
        continue
      }
      const mcpConfig = config[clientName]
      const entry = isMcpConfigured(mcpConfig) ? mcpConfig : undefined
      const timeout = entry?.timeout ?? defaultTimeout
      for (const mcpTool of toolsResult.tools) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
        const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        result[sanitizedClientName + "_" + sanitizedToolName] = await convertMcpTool(mcpTool, client, timeout)
      }
    }
    return result
  }

  export async function prompts() {
    const s = await state()
    const clientsSnapshot = await clients()

    const prompts = Object.fromEntries<PromptInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchPromptsForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return prompts
  }

  export async function resources() {
    const s = await state()
    const clientsSnapshot = await clients()

    const result = Object.fromEntries<ResourceInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchResourcesForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return result
  }

  export async function getPrompt(clientName: string, name: string, args?: Record<string, string>) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName,
      })
      return undefined
    }

    const result = await client
      .getPrompt({
        name: name,
        arguments: args,
      })
      .catch((e) => {
        log.error("failed to get prompt from MCP server", {
          clientName,
          promptName: name,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  export async function readResource(clientName: string, resourceUri: string) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName: clientName,
      })
      return undefined
    }

    const result = await client
      .readResource({
        uri: resourceUri,
      })
      .catch((e) => {
        log.error("failed to get prompt from MCP server", {
          clientName: clientName,
          resourceUri: resourceUri,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  /**
   * Start OAuth authentication flow for an MCP server.
   * Returns the authorization URL that should be opened in a browser.
   */
  export async function startAuth(mcpName: string): Promise<{ authorizationUrl: string }> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]

    if (!mcpConfig) {
      throw new Error(`MCP server not found: ${mcpName}`)
    }

    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }

    if (mcpConfig.oauth === false) {
      throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
    }

    // Start the callback server
    await McpOAuthCallback.ensureRunning()

    // Generate and store a cryptographically secure state parameter BEFORE creating the provider
    // The SDK will call provider.state() to read this value
    const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    await McpAuth.updateOAuthState(mcpName, oauthState)

    // Generate and store PKCE code verifier for added security
    // The SDK will call provider.codeVerifier() and provider.saveCodeVerifier() during the flow
    const codeVerifier = Crypto.generateCodeVerifier()
    await McpAuth.updateCodeVerifier(mcpName, codeVerifier)

    // Create a new auth provider for this flow
    // OAuth config is optional - if not provided, we'll use auto-discovery
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

    // Create transport with auth provider
    const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
      authProvider,
    })

    // Try to connect - this will trigger the OAuth flow
    try {
      const client = new Client({
        name: "opencode",
        version: Installation.VERSION,
      })
      await client.connect(transport)
      // If we get here, we're already authenticated
      return { authorizationUrl: "" }
    } catch (error) {
      if (error instanceof UnauthorizedError && capturedUrl) {
        // Store transport for finishAuth
        pendingOAuthTransports.set(mcpName, transport)
        return { authorizationUrl: capturedUrl.toString() }
      }
      throw error
    }
  }

  /**
   * Complete OAuth authentication after user authorizes in browser.
   * Opens the browser and waits for callback.
   */
  export async function authenticate(mcpName: string): Promise<Status> {
    const { authorizationUrl } = await startAuth(mcpName)

    if (!authorizationUrl) {
      // Already authenticated
      const s = await state()
      return s.status[mcpName] ?? { status: "connected" }
    }

    // Get the state that was already generated and stored in startAuth()
    const oauthState = await McpAuth.getOAuthState(mcpName)
    if (!oauthState) {
      throw new Error("OAuth state not found - this should not happen")
    }

    // The SDK has already added the state parameter to the authorization URL
    // We just need to open the browser
    log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

    // Register the callback BEFORE opening the browser to avoid race condition
    // when the IdP has an active SSO session and redirects immediately
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

    try {
      const subprocess = await open(authorizationUrl)
      // The open package spawns a detached process and returns immediately.
      // We need to listen for errors which fire asynchronously:
      // - "error" event: command not found (ENOENT)
      // - "exit" with non-zero code: command exists but failed (e.g., no display)
      await new Promise<void>((resolve, reject) => {
        // Give the process a moment to fail if it's going to
        const timeout = setTimeout(() => resolve(), 500)
        subprocess.on("error", (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        subprocess.on("exit", (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout)
            reject(new Error(`Browser open failed with exit code ${code}`))
          }
        })
      })
    } catch (error) {
      // Browser opening failed (e.g., in remote/headless sessions like SSH, devcontainers)
      // Emit event so CLI can display the URL for manual opening
      log.warn("failed to open browser, user must open URL manually", { mcpName, error })
      Bus.publish(BrowserOpenFailed, { mcpName, url: authorizationUrl })
    }

    // Wait for callback using the already-registered promise
    const code = await callbackPromise

    // Validate and clear the state using constant-time comparison to prevent timing attacks
    const storedState = await McpAuth.getOAuthState(mcpName)
    if (!storedState || !Crypto.timingSafeCompare(storedState, oauthState)) {
      await McpAuth.clearOAuthState(mcpName)
      throw new Error("OAuth state mismatch - potential CSRF attack")
    }

    await McpAuth.clearOAuthState(mcpName)

    // Finish auth
    return finishAuth(mcpName, code)
  }

  /**
   * Complete OAuth authentication with the authorization code.
   */
  export async function finishAuth(mcpName: string, authorizationCode: string): Promise<Status> {
    const transport = pendingOAuthTransports.get(mcpName)

    if (!transport) {
      throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
    }

    try {
      // Call finishAuth on the transport
      await transport.finishAuth(authorizationCode)

      // Clear the code verifier after successful auth
      await McpAuth.clearCodeVerifier(mcpName)

      // Now try to reconnect
      const cfg = await Config.get()
      const mcpConfig = cfg.mcp?.[mcpName]

      if (!mcpConfig) {
        throw new Error(`MCP server not found: ${mcpName}`)
      }

      if (!isMcpConfigured(mcpConfig)) {
        throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
      }

      // Re-add the MCP server to establish connection
      pendingOAuthTransports.delete(mcpName)
      const result = await add(mcpName, mcpConfig)

      const statusRecord = result.status as Record<string, Status>
      return statusRecord[mcpName] ?? { status: "failed", error: "Unknown error after auth" }
    } catch (error) {
      log.error("failed to finish oauth", { mcpName, error })
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Remove OAuth credentials for an MCP server.
   */
  export async function removeAuth(mcpName: string): Promise<void> {
    await McpAuth.remove(mcpName)
    McpOAuthCallback.cancelPending(mcpName)
    pendingOAuthTransports.delete(mcpName)
    await McpAuth.clearOAuthState(mcpName)
    log.info("removed oauth credentials", { mcpName })
  }

  /**
   * Check if an MCP server supports OAuth (remote servers support OAuth by default unless explicitly disabled).
   */
  export async function supportsOAuth(mcpName: string): Promise<boolean> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]
    if (!mcpConfig) return false
    if (!isMcpConfigured(mcpConfig)) return false
    return mcpConfig.type === "remote" && mcpConfig.oauth !== false
  }

  /**
   * Check if an MCP server has stored OAuth tokens.
   */
  export async function hasStoredTokens(mcpName: string): Promise<boolean> {
    const entry = await McpAuth.get(mcpName)
    return !!entry?.tokens
  }

  export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

  /**
   * Get the authentication status for an MCP server.
   */
  export async function getAuthStatus(mcpName: string): Promise<AuthStatus> {
    const hasTokens = await hasStoredTokens(mcpName)
    if (!hasTokens) return "not_authenticated"
    const expired = await McpAuth.isTokenExpired(mcpName)
    return expired ? "expired" : "authenticated"
  }

  Scheduler.register({
    id: "mcp.reconnect",
    interval: RECONNECT_BASE,
    scope: "global",
    run: async () => {
      const now = Date.now()
      const cfg = await Config.get()
      const config = cfg.mcp ?? {}
      const s = await state()

      for (const [name, entry] of Object.entries(config)) {
        if (!isMcpConfigured(entry)) continue
        if (entry.enabled === false) continue

        const status = s.status[name]
        if (!status || status.status !== "failed") {
          reconnectState.delete(name)
          continue
        }

        const backoff = reconnectState.get(name)
        if (backoff && backoff.nextAt > now) continue

        await connect(name)

        const next = s.status[name]
        if (next?.status === "connected") {
          reconnectState.delete(name)
          continue
        }

        const attempt = (backoff?.attempt ?? 0) + 1
        const delay = Math.min(RECONNECT_BASE * 2 ** Math.min(attempt, 5), RECONNECT_MAX)
        reconnectState.set(name, { attempt, nextAt: now + delay })
      }
    },
  })
}
