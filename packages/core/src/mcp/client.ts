export * as McpClient from "./client.js"

import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  UnsupportedProtocolVersionError,
  type CallToolResult as SdkCallToolResult,
  type ElicitRequestFormParams,
  type ElicitRequestParams,
  type ElicitRequestURLParams,
  type ElicitResult,
  type GetPromptResult,
  type Implementation,
  type OAuthClientProvider,
  type Prompt,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplateType,
  type Tool,
  type Transport,
  type VersionNegotiationOptions,
} from "@modelcontextprotocol/client"
import { Cause, Effect, Exit, Schema } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import type { Session } from "@opencode/schema/session"
import { McpStdio } from "./stdio.js"

const DEFAULT_STARTUP_TIMEOUT = 30_000
const DEFAULT_CATALOG_TIMEOUT = 30_000
const DEFAULT_EXECUTION_TIMEOUT = 12 * 60 * 60 * 1_000 // 12 hours
const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

export type { GetPromptResult, Prompt, ReadResourceResult, Resource, Tool }
export type ResourceTemplate = ResourceTemplateType

export class NeedsAuthError extends Schema.TaggedError<NeedsAuthError>()("MCP.NeedsAuthError", {
  server: Schema.String,
}) {
  override get message() {
    return `MCP server requires authentication: ${this.server}`
  }
}

export class ConnectError extends Schema.TaggedError<ConnectError>()("MCP.ConnectError", {
  server: Schema.String,
  message: Schema.String,
}) {}

/** A legacy Streamable HTTP server no longer recognizes this connection's session; the lifecycle reconnects. */
export class SessionExpiredError extends Schema.TaggedError<SessionExpiredError>()("MCP.SessionExpiredError", {
  server: Schema.String,
}) {
  override get message() {
    return `MCP server session expired: ${this.server}`
  }
}

export type CallToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "media"; readonly data: string; readonly mimeType: string }

export interface CallToolResult {
  readonly isError: boolean
  readonly structured?: unknown
  readonly content: ReadonlyArray<CallToolContent>
}

export type ElicitationFormParams = ElicitRequestFormParams
export type ElicitationParams = ElicitRequestParams
export type ElicitationResult = ElicitResult

export interface ElicitationHandler {
  readonly create: (input: {
    readonly server: string
    readonly params: ElicitationParams
    readonly signal: AbortSignal
  }) => Effect.Effect<ElicitationResult, Error>
  /**
   * Legacy era only: the server announces that a URL-mode elicitation finished out of band. Removed in
   * 2026-07-28, where the client learns the outcome by retrying, but legacy servers still send it and
   * it lets the form settle without the user re-running the tool.
   */
  readonly complete: (input: {
    readonly server: string
    readonly elicitationID: ElicitRequestURLParams["elicitationId"]
  }) => Effect.Effect<void>
}

/** Handle over a connected MCP server that keeps the SDK `Client` out of the rest of core. */
export interface Connection {
  /** True when the connection negotiated revision 2026-07-28 or later; false is the initialize handshake. */
  readonly modern: boolean
  readonly instructions: string | undefined
  readonly tools: () => Effect.Effect<Tool[], Error>
  readonly prompts: () => Effect.Effect<Prompt[], Error>
  readonly resources: () => Effect.Effect<Resource[], Error>
  readonly resourceTemplates: () => Effect.Effect<ResourceTemplateType[], Error>
  /** Resolves to undefined when the server does not advertise resources. */
  readonly readResource: (input: { readonly uri: string }) => Effect.Effect<ReadResourceResult | undefined, Error>
  readonly prompt: (input: {
    readonly name: string
    readonly args?: Record<string, string>
  }) => Effect.Effect<GetPromptResult, Error>
  readonly callTool: (input: {
    readonly name: string
    readonly args?: Record<string, unknown>
    readonly sessionID?: Session.ID
  }) => Effect.Effect<CallToolResult, Error>
  readonly onClose: (callback: () => void) => void
  readonly onSessionExpired: (callback: () => void) => void
  readonly onToolsChanged: (callback: () => void) => void
  readonly onPromptsChanged: (callback: () => void) => void
  readonly onResourcesChanged: (callback: () => void) => void
}

/**
 * Connects an MCP server; closing the calling scope tears down the transport and any spawned process.
 * A stdio server is spawned through the location's `Environment`, so it runs wherever the location's
 * shell commands run rather than always on the host.
 */
export const connect = Effect.fnUntraced(function* (
  server: string,
  config: typeof ConfigMCP.Server.Type,
  directory: string,
  // Remote only. A provider with no stored token and a no-op redirect ends in UnauthorizedError → needs_auth.
  authProvider?: OAuthClientProvider,
  elicitation?: ElicitationHandler,
  clientInfo: Implementation = { name: "opencode", version: "unknown" },
) {
  // The SDK takes list-changed handlers at construction, but consumers register after connect. On a
  // modern connection the SDK opens the subscriptions/listen stream behind these itself.
  const changed = { tools: () => {}, prompts: () => {}, resources: () => {} }
  const listChanged = (key: keyof typeof changed) => ({
    autoRefresh: false,
    debounceMs: 0,
    onChanged: () => changed[key](),
  })

  const initialize = Effect.fnUntraced(function* (transport: Transport) {
    const client = new Client(clientInfo, {
      capabilities: {
        ...(elicitation ? { elicitation: { form: { applyDefaults: true }, url: {} } } : {}),
        // Legacy era only: roots are deprecated as of 2026-07-28 and modern servers cannot request them.
        // Some legacy servers refuse to run without one (https://github.com/anomalyco/opencode/issues/2308).
        roots: {},
      },
      versionNegotiation: negotiation(config.protocol),
      listChanged: {
        tools: listChanged("tools"),
        prompts: listChanged("prompts"),
        resources: listChanged("resources"),
      },
    })
    client.setRequestHandler("roots/list", () => ({ roots: [{ uri: pathToFileURL(directory).href }] }))
    if (elicitation) {
      client.setRequestHandler("elicitation/create", (request, ctx) =>
        Effect.runPromise(elicitation.create({ server, params: request.params, signal: ctx.mcpReq.signal })),
      )
      client.setNotificationHandler("notifications/elicitation/complete", (notification) =>
        Effect.runPromise(elicitation.complete({ server, elicitationID: notification.params.elicitationId })),
      )
    }

    yield* Effect.tryPromise({
      try: (signal) =>
        client.connect(transport, { timeout: config.timeout?.startup ?? DEFAULT_STARTUP_TIMEOUT, signal }),
      catch: (error) => error,
    }).pipe(Effect.onError(() => Effect.promise(() => transport.close()).pipe(Effect.ignore)))
    return client
  })

  // Legacy era only: the transport holds the Mcp-Session-Id the server minted, and the server answering
  // it with 404, or with the 400 a freshly restarted single-session server emits, means it no longer
  // knows this connection. Modern connections never carry a session id, so a modern 404 for an unknown
  // method is not mistaken for expiry. Other 400s pass through untouched.
  const session: { transport?: StreamableHTTPClientTransport; expired?: () => void; reported: boolean } = {
    reported: false,
  }
  const failure = (error: unknown) => {
    if (!(error instanceof SdkHttpError) || session.transport?.sessionId === undefined) return toError(error)
    const expired =
      error.status === 404 ||
      (error.status === 400 &&
        typeof error.data.text === "string" &&
        error.data.text.includes("Bad Request: Server not initialized"))
    if (!expired) return toError(error)
    if (!session.reported) {
      session.reported = true
      session.expired?.()
    }
    return new SessionExpiredError({ server })
  }

  const exit = yield* Effect.gen(function* () {
    if (config.type === "local") {
      const [command, ...args] = config.command
      const transport = yield* McpStdio.make({
        server,
        command,
        args,
        cwd: config.cwd ? path.resolve(directory, config.cwd) : directory,
        environment: {
          ...(command === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...config.environment,
        },
      })
      return yield* initialize(transport)
    }
    if (!URL.canParse(config.url))
      return yield* new ConnectError({ server, message: `Invalid MCP URL for "${server}"` })
    const { McpOAuth } = yield* Effect.promise(() => import("./oauth.js"))
    const fetch = yield* McpOAuth.loggedFetch({ server, directory })
    // Servers that bundle their own Code Mode (Cloudflare and others) expose raw tools when asked
    // with ?codemode=false, which is what our Code Mode wants. The configured URL stays the OAuth identity.
    const url = new URL(config.url)
    const addedCodemode = config.codemode !== false && !url.searchParams.has("codemode")
    if (addedCodemode) url.searchParams.set("codemode", "false")
    const open = (url: URL) => {
      session.transport = new StreamableHTTPClientTransport(url, {
        requestInit: config.headers ? { headers: config.headers } : undefined,
        authProvider,
        fetch,
      })
      return initialize(session.transport)
    }

    return yield* open(url).pipe(
      Effect.catch((error) => {
        if (!addedCodemode || !(error instanceof SdkHttpError) || (error.status !== 400 && error.status !== 404))
          return Effect.fail(error)
        // Servers that reject unknown query params get one retry at the configured URL.
        return open(new URL(config.url))
      }),
    )
  }).pipe(Effect.exit)
  if (Exit.isSuccess(exit)) {
    const client = exit.value
    yield* Effect.addFinalizer(() => Effect.promise(() => client.close()).pipe(Effect.ignore))
    const catalog = { timeout: config.timeout?.catalog ?? DEFAULT_CATALOG_TIMEOUT }
    const execution = config.timeout?.execution ?? DEFAULT_EXECUTION_TIMEOUT
    const request = <A>(what: string, run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: failure }).pipe(
        Effect.tapError((error) => Effect.logWarning(`failed to ${what}`, { server, error: error.message })),
      )

    return {
      modern: client.getProtocolEra() === "modern",
      instructions: client.getInstructions()?.trim() || undefined,
      tools: () =>
        request("list MCP tools", () => client.listTools(undefined, catalog)).pipe(Effect.map((r) => r.tools)),
      prompts: () =>
        request("list MCP prompts", () => client.listPrompts(undefined, catalog)).pipe(Effect.map((r) => r.prompts)),
      resources: () =>
        request("list MCP resources", () => client.listResources(undefined, catalog)).pipe(
          Effect.map((r) => r.resources),
        ),
      resourceTemplates: () =>
        request("list MCP resource templates", () => client.listResourceTemplates(undefined, catalog)).pipe(
          Effect.map((r) => r.resourceTemplates),
        ),
      readResource: (input) => {
        if (!client.getServerCapabilities()?.resources) return Effect.succeed(undefined)
        return request("read MCP resource", (signal) =>
          client.readResource({ uri: input.uri }, { signal, timeout: execution }),
        )
      },
      prompt: (input) =>
        request("get MCP prompt", (signal) =>
          client.getPrompt({ name: input.name, arguments: input.args ?? {} }, { signal, timeout: execution }),
        ),
      callTool: (input) =>
        request("call MCP tool", (signal) =>
          client.callTool(
            {
              name: input.name,
              arguments: input.args ?? {},
              ...(input.sessionID === undefined ? {} : { _meta: { "ai.opencode/sessionID": input.sessionID } }),
            },
            // Requesting progress keeps long calls alive under the SDK's timeout; execution is the hard wall.
            { signal, timeout: execution, onprogress: () => {} },
          ),
        ).pipe(Effect.map(toCallToolResult)),
      onClose: (callback) => {
        client.onclose = callback
      },
      onSessionExpired: (callback) => {
        session.expired = callback
      },
      onToolsChanged: (callback) => {
        changed.tools = callback
      },
      onPromptsChanged: (callback) => {
        changed.prompts = callback
      },
      onResourcesChanged: (callback) => {
        changed.resources = callback
      },
    } satisfies Connection
  }

  const error = Cause.squash(exit.cause)
  if (error instanceof UnauthorizedError) return yield* new NeedsAuthError({ server })
  if (error instanceof UnsupportedProtocolVersionError)
    return yield* new ConnectError({
      server,
      message: `${error.message}; the server supports ${error.supported.join(", ")}. Set "protocol" for this server to one of those or to "legacy".`,
    })
  return yield* new ConnectError({ server, message: error instanceof Error ? error.message : String(error) })
})

// Absent config is legacy: the SDK sends the plain initialize handshake with no discover probe.
function negotiation(protocol: ConfigMCP.Protocol | undefined): VersionNegotiationOptions | undefined {
  if (protocol === undefined || protocol === "legacy") return undefined
  if (protocol === "auto") return { mode: "auto" }
  return { mode: { pin: protocol } }
}

function toCallToolResult(result: SdkCallToolResult): CallToolResult {
  return {
    isError: result.isError === true,
    structured: result.structuredContent,
    content: result.content.flatMap((part): CallToolContent[] => {
      if (part.type === "text") return [{ type: "text", text: part.text }]
      if (part.type === "image" || part.type === "audio")
        return [{ type: "media", data: part.data, mimeType: part.mimeType }]
      if (part.type === "resource_link") return [{ type: "text", text: part.uri }]
      if (part.type === "resource") {
        const resource = part.resource
        if ("text" in resource && typeof resource.text === "string") return [{ type: "text", text: resource.text }]
        if ("blob" in resource && typeof resource.blob === "string" && typeof resource.mimeType === "string")
          return [{ type: "media", data: resource.blob, mimeType: resource.mimeType }]
        return [{ type: "text", text: resource.uri }]
      }
      return []
    }),
  }
}
