export * as McpClient from "./client.js"

import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type ElicitRequestFormParams,
  type ElicitRequestParams,
  type ElicitRequestURLParams,
  type ElicitResult,
  type Implementation,
  type OAuthClientProvider,
  type ProtocolEra,
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

export type Era = ProtocolEra

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

/**
 * A legacy Streamable HTTP server no longer recognizes this connection's session, typically because
 * it restarted. The connection is unusable until it is re-established; the request that observed
 * the expiry is not retried here.
 */
export class SessionExpiredError extends Schema.TaggedError<SessionExpiredError>()("MCP.SessionExpiredError", {
  server: Schema.String,
}) {
  override get message() {
    return `MCP server session expired: ${this.server}`
  }
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string | undefined
  readonly inputSchema: unknown
  readonly outputSchema: unknown
}

export interface PromptDefinition {
  readonly name: string
  readonly description: string | undefined
  readonly arguments:
    | ReadonlyArray<{
        readonly name: string
        readonly description: string | undefined
        readonly required: boolean | undefined
      }>
    | undefined
}

export interface PromptMessage {
  readonly role: string
  readonly content: unknown
}

export interface PromptResult {
  readonly messages: ReadonlyArray<PromptMessage>
}

export interface ResourceDefinition {
  readonly name: string
  readonly uri: string
  readonly description: string | undefined
  readonly mimeType: string | undefined
}

export interface ResourceTemplateDefinition {
  readonly name: string
  readonly uriTemplate: string
  readonly description: string | undefined
  readonly mimeType: string | undefined
}

export type ResourceContentPart =
  | { readonly type: "text"; readonly uri: string; readonly text: string; readonly mimeType: string | undefined }
  | { readonly type: "blob"; readonly uri: string; readonly blob: string; readonly mimeType: string | undefined }

export interface ReadResourceResult {
  readonly contents: ReadonlyArray<ResourceContentPart>
}

export type CallToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "media"; readonly data: string; readonly mimeType: string }

export interface CallToolResult {
  readonly isError: boolean
  readonly structured: unknown
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
  readonly complete: (input: {
    readonly server: string
    readonly elicitationID: ElicitRequestURLParams["elicitationId"]
  }) => Effect.Effect<void>
}

/** Handle over a connected MCP server that keeps the SDK `Client` out of the rest of core. */
export interface Connection {
  /**
   * Protocol family negotiated for this connection. `legacy` covers revisions through 2025-11-25
   * (initialize handshake, server-initiated requests); `modern` is 2026-07-28 and later.
   */
  readonly era: Era
  /** Server-supplied usage instructions from the initialize or discover result, if any. */
  readonly instructions: string | undefined
  /** Lists the server's tools; returns [] when the server doesn't advertise tool support, fails on a transport error. */
  readonly tools: () => Effect.Effect<ToolDefinition[], Error>
  /** Lists the server's prompts; returns [] when the server doesn't advertise prompt support, fails on a transport error. */
  readonly prompts: () => Effect.Effect<PromptDefinition[], Error>
  /** Lists the server's resources; returns [] when the server doesn't advertise resource support. */
  readonly resources: () => Effect.Effect<ResourceDefinition[], Error>
  /** Lists the server's resource templates; returns [] when the server doesn't advertise resource support. */
  readonly resourceTemplates: () => Effect.Effect<ResourceTemplateDefinition[], Error>
  /** Reads one resource; returns undefined when the server doesn't advertise resource support. */
  readonly readResource: (input: { readonly uri: string }) => Effect.Effect<ReadResourceResult | undefined, Error>
  /** Invokes a prompt on the server. Interruption aborts the in-flight request. */
  readonly prompt: (input: {
    readonly name: string
    readonly args?: Record<string, string>
  }) => Effect.Effect<PromptResult, Error>
  /** Invokes a tool on the server. Interruption aborts the in-flight request. */
  readonly callTool: (input: {
    readonly name: string
    readonly args?: Record<string, unknown>
    readonly sessionID?: Session.ID
  }) => Effect.Effect<CallToolResult, Error>
  readonly onClose: (callback: () => void) => void
  /** Registers a callback fired once when a request observes that the server dropped this session. */
  readonly onSessionExpired: (callback: () => void) => void
  /** Registers a callback fired when the server announces its tool list changed; no-op if unsupported. */
  readonly onToolsChanged: (callback: () => void) => void
  /** Registers a callback fired when the server announces its prompt list changed; no-op if unsupported. */
  readonly onPromptsChanged: (callback: () => void) => void
  /** Registers a callback fired when the server announces its resource catalog changed. */
  readonly onResourcesChanged: (callback: () => void) => void
}

/**
 * Connects an MCP server; closing the calling scope tears down the transport and any spawned process.
 *
 * A stdio server is spawned through the location's `Environment`, so it runs on the same execution
 * plane as the location's shell commands rather than always on the host.
 */
export const connect = Effect.fnUntraced(function* (
  server: string,
  config: typeof ConfigMCP.Server.Type,
  directory: string,
  // Only consumed by the remote transport; stdio servers have no auth concept. A provider with no
  // stored token (and a no-op redirect) surfaces an UnauthorizedError, which we map to needs_auth.
  authProvider?: OAuthClientProvider,
  elicitation?: ElicitationHandler,
  clientInfo: Implementation = { name: "opencode", version: "unknown" },
) {
  // List-changed handlers must be supplied when the SDK client is built, but Connection consumers
  // register theirs after connect. These slots bridge the two; the SDK only activates a handler
  // when the server advertises the matching listChanged capability, and on a modern connection it
  // opens the subscriptions/listen stream that carries those notifications.
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
        // https://github.com/anomalyco/opencode/issues/2308
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

  // Only a legacy HTTP session can expire: the transport holds the session id the server minted, and
  // the server answering that id with 404 (unknown session) or the specific 400 a freshly restarted
  // single-session server emits means it no longer knows this connection. Modern connections never
  // carry a session id, so a modern 404 for an unknown method is not mistaken for expiry. Other 400s
  // are real request errors and pass through untouched.
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
    // Prefer raw tools for our Code Mode without changing the configured URL used for OAuth identity.
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
        // Some servers reject unknown query params. Retry once with the user's original URL.
        return open(new URL(config.url))
      }),
    )
  }).pipe(Effect.exit)
  if (Exit.isSuccess(exit)) {
    const client = exit.value
    // Closing the client closes the transport, which ends stdin and then kills through the spawner
    // handle if the server does not exit cleanly. The process scope remains a final backstop.
    yield* Effect.addFinalizer(() => Effect.promise(() => client.close()).pipe(Effect.ignore))
    const catalogTimeout = config.timeout?.catalog ?? DEFAULT_CATALOG_TIMEOUT
    const executionTimeout = config.timeout?.execution ?? DEFAULT_EXECUTION_TIMEOUT
    return {
      // The SDK reports the era once connect() resolves; a legacy default with no probe is still legacy.
      era: client.getProtocolEra() ?? "legacy",
      instructions: client.getInstructions()?.trim() || undefined,
      tools: () =>
        Effect.gen(function* () {
          if (!client.getServerCapabilities()?.tools) return []
          const tools = yield* Effect.tryPromise({
            try: () =>
              client.listTools(undefined, { timeout: catalogTimeout }).then((result) => result.tools),
            catch: failure,
          }).pipe(
            Effect.tapError((error) => Effect.logWarning("failed to list MCP tools", { server, error: error.message })),
          )
          return tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: "outputSchema" in tool ? tool.outputSchema : undefined,
          }))
        }),
      prompts: () =>
        Effect.gen(function* () {
          if (!client.getServerCapabilities()?.prompts) return []
          const prompts = yield* Effect.tryPromise({
            try: () =>
              client.listPrompts(undefined, { timeout: catalogTimeout }).then((result) => result.prompts),
            catch: failure,
          }).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("failed to list MCP prompts", { server, error: error.message }),
            ),
          )
          return prompts.map((prompt) => ({
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments?.map((argument) => ({
              name: argument.name,
              description: argument.description,
              required: argument.required,
            })),
          }))
        }),
      resources: () =>
        Effect.gen(function* () {
          if (!client.getServerCapabilities()?.resources) return []
          const resources = yield* Effect.tryPromise({
            try: () =>
              client.listResources(undefined, { timeout: catalogTimeout }).then((result) => result.resources),
            catch: failure,
          }).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("failed to list MCP resources", { server, error: error.message }),
            ),
          )
          return resources.map((resource) => ({
            name: resource.name,
            uri: resource.uri,
            description: resource.description,
            mimeType: resource.mimeType,
          }))
        }),
      resourceTemplates: () =>
        Effect.gen(function* () {
          if (!client.getServerCapabilities()?.resources) return []
          const templates = yield* Effect.tryPromise({
            try: () =>
              client
                .listResourceTemplates(undefined, { timeout: catalogTimeout })
                .then((result) => result.resourceTemplates),
            catch: failure,
          }).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("failed to list MCP resource templates", { server, error: error.message }),
            ),
          )
          return templates.map((template) => ({
            name: template.name,
            uriTemplate: template.uriTemplate,
            description: template.description,
            mimeType: template.mimeType,
          }))
        }),
      readResource: (input) =>
        Effect.gen(function* () {
          if (!client.getServerCapabilities()?.resources) return undefined
          const result = yield* Effect.tryPromise({
            try: (signal) => client.readResource({ uri: input.uri }, { signal, timeout: executionTimeout }),
            catch: failure,
          }).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("failed to read MCP resource", { server, uri: input.uri, error: error.message }),
            ),
          )
          return {
            contents: result.contents.map(
              (part): ResourceContentPart =>
                "text" in part
                  ? { type: "text", uri: part.uri, text: part.text, mimeType: part.mimeType }
                  : { type: "blob", uri: part.uri, blob: part.blob, mimeType: part.mimeType },
            ),
          }
        }),
      prompt: (input) =>
        Effect.tryPromise({
          try: (signal) =>
            client.getPrompt({ name: input.name, arguments: input.args ?? {} }, { signal, timeout: executionTimeout }),
          catch: failure,
        }).pipe(
          Effect.map((result) => ({
            messages: result.messages.map((message) => ({ role: message.role, content: message.content })),
          })),
        ),
      callTool: (input) =>
        Effect.tryPromise({
          try: (signal) =>
            client.callTool(
              {
                name: input.name,
                arguments: input.args ?? {},
                ...(input.sessionID === undefined ? {} : { _meta: { sessionID: input.sessionID } }),
              },
              // Keep progress tokens available while enforcing a hard wall-clock execution timeout.
              { signal, timeout: executionTimeout, onprogress: () => {} },
            ),
          catch: failure,
        }).pipe(
          Effect.map((result) => ({
            isError: result.isError === true,
            structured: result.structuredContent,
            content: result.content.flatMap((part): CallToolContent[] => {
              if (part.type === "text") return [{ type: "text", text: part.text }]
              if (part.type === "image" || part.type === "audio")
                return [{ type: "media", data: part.data, mimeType: part.mimeType }]
              if (part.type === "resource_link") return [{ type: "text", text: part.uri }]
              if (part.type === "resource") {
                const resource = part.resource
                if ("text" in resource && typeof resource.text === "string")
                  return [{ type: "text", text: resource.text }]
                if ("blob" in resource && typeof resource.blob === "string" && typeof resource.mimeType === "string")
                  return [{ type: "media", data: resource.blob, mimeType: resource.mimeType }]
                return [{ type: "text", text: resource.uri }]
              }
              return []
            }),
          })),
        ),
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
  return yield* new ConnectError({ server, message: error instanceof Error ? error.message : String(error) })
})

// Absent config is legacy: the SDK sends the plain initialize handshake with no discover probe.
function negotiation(protocol: ConfigMCP.Protocol | undefined): VersionNegotiationOptions | undefined {
  if (protocol === undefined || protocol === "legacy") return undefined
  if (protocol === "auto") return { mode: "auto" }
  return { mode: { pin: protocol } }
}
