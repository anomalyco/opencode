export * as McpClient from "./client.js"

import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  Client,
  LOG_LEVEL_META_KEY,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
  type Transport,
  type Tool,
  type Implementation,
  type ElicitRequestFormParams,
  type ElicitRequestURLParams,
  type ElicitResult,
  type LoggingMessageNotification,
  type SubscriptionFilter,
} from "@modelcontextprotocol/client"
import { DefaultJsonSchemaValidator } from "@modelcontextprotocol/client/_shims"
import { ListToolsResultSchema, ToolSchema } from "@modelcontextprotocol/core"
import { Cause, Effect, Exit, Schedule, Schema } from "effect"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
import type { Session } from "@opencode-ai/schema/session"
import { McpStdio } from "./stdio.js"

const DEFAULT_STARTUP_TIMEOUT = 30_000
const DEFAULT_CATALOG_TIMEOUT = 30_000
const DEFAULT_EXECUTION_TIMEOUT = 12 * 60 * 60 * 1_000 // 12 hours
const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

// Drop only structurally malformed outputSchema fields; compilation is checked after listing.
// All other tool fields and the response envelope keep their SDK validation.
const TolerantListToolsResult = ListToolsResultSchema.extend({
  tools: ToolSchema.extend({ outputSchema: ToolSchema.shape.outputSchema.catch(undefined) })
    .transform((tool) => {
      if (tool.outputSchema === undefined) delete tool.outputSchema
      return tool
    })
    .array(),
})

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
export type ElicitationParams =
  | ElicitationFormParams
  | (Omit<ElicitRequestURLParams, "elicitationId"> & {
      /** Legacy servers may identify a URL request for an optional completion notification. */
      readonly elicitationId?: string
    })
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

export interface LogMessage {
  readonly level: LoggingMessageNotification["params"]["level"]
  readonly logger?: LoggingMessageNotification["params"]["logger"]
  readonly data: LoggingMessageNotification["params"]["data"]
}

/** Handle over a connected MCP server that keeps the SDK `Client` out of the rest of core. */
export interface Connection {
  /** Server-supplied usage instructions from discovery or initialization, if any. */
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
  /** Registers a callback fired when the server emits an MCP logging notification. */
  readonly onLog: (callback: (message: LogMessage) => void) => void
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
  const validator = new DefaultJsonSchemaValidator()
  const startupTimeout = config.timeout?.startup ?? DEFAULT_STARTUP_TIMEOUT
  const connectClient = Effect.fnUntraced(function* (transport: Transport, probeTransport?: Transport) {
    const client = new Client(clientInfo, {
      versionNegotiation: {
        mode: "auto",
        // Silent legacy stdio servers must leave time for the real initialize handshake.
        probe: { timeoutMs: config.type === "local" ? Math.min(3_000, startupTimeout / 2) : startupTimeout },
      },
      jsonSchemaValidator: validator,
      capabilities: {
        ...(elicitation ? { elicitation: { form: { applyDefaults: true }, url: {} } } : {}),
        // https://github.com/anomalyco/opencode/issues/2308
        roots: {},
      },
    })
    client.setRequestHandler("roots/list", () => Promise.resolve({ roots: [{ uri: pathToFileURL(directory).href }] }))
    if (elicitation) {
      client.setRequestHandler("elicitation/create", (request, ctx) =>
        Effect.runPromise(
          elicitation.create({
            server,
            params: request.params,
            signal: ctx.mcpReq.signal,
          }),
          { signal: ctx.mcpReq.signal },
        ),
      )
      client.setNotificationHandler("notifications/elicitation/complete", (notification) =>
        Effect.runPromise(elicitation.complete({ server, elicitationID: notification.params.elicitationId })),
      )
    }

    const abort = new AbortController()
    const connecting = client.connect(transport, { timeout: startupTimeout, signal: abort.signal, probeTransport })
    yield* Effect.tryPromise({
      try: () => connecting,
      catch: toError,
    }).pipe(
      Effect.onError(() =>
        Effect.promise(async () => {
          abort.abort()
          await transport.close().catch(() => {})
          // Effect interruption stops waiting on the promise; join the SDK's probe cleanup too.
          await connecting.catch(() => {})
        }),
      ),
    )
    return client
  })

  const exit = yield* Effect.gen(function* () {
    if (config.type === "local") {
      const [command, ...args] = config.command
      const options: McpStdio.Options = {
        server,
        command,
        args,
        cwd: config.cwd ? path.resolve(directory, config.cwd) : directory,
        environment: {
          ...(command === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...config.environment,
        },
      }
      const transport = yield* McpStdio.make(options)
      const probeTransport = yield* McpStdio.make(options)
      return yield* connectClient(transport, probeTransport)
    }
    if (!URL.canParse(config.url))
      return yield* new ConnectError({ server, message: `Invalid MCP URL for "${server}"` })
    // Prefer raw tools for our Code Mode without changing the configured URL used for OAuth identity.
    const url = new URL(config.url)
    const addedCodemode = config.codemode !== false && !url.searchParams.has("codemode")
    if (addedCodemode) url.searchParams.set("codemode", "false")
    const open = (url: URL) =>
      connectClient(
        new StreamableHTTPClientTransport(url, {
          requestInit: config.headers ? { headers: config.headers } : undefined,
          authProvider,
        }),
      )

    return yield* open(url).pipe(
      Effect.catch((error) => {
        if (!addedCodemode || !(error instanceof SdkHttpError) || error.status !== 404) return Effect.fail(error)
        // Some servers reject unknown query params. Retry once with the user's original URL.
        return open(new URL(config.url))
      }),
    )
  }).pipe(
    Effect.timeoutOrElse({ duration: startupTimeout, orElse: () => Effect.fail(new Error("MCP startup timed out")) }),
    Effect.exit,
  )
  if (Exit.isSuccess(exit)) {
    const client = exit.value
    // Closing the client closes the transport, which ends stdin and then kills through the spawner
    // handle if the server does not exit cleanly. The process scope remains a final backstop.
    yield* Effect.addFinalizer(() => Effect.promise(() => client.close()).pipe(Effect.ignore))
    const catalogTimeout = config.timeout?.catalog ?? DEFAULT_CATALOG_TIMEOUT
    const executionTimeout = config.timeout?.execution ?? DEFAULT_EXECUTION_TIMEOUT
    const executionDeadline = Effect.timeoutOrElse({
      duration: executionTimeout,
      orElse: () => Effect.fail(new Error("Request timed out")),
    })
    const modern = client.getProtocolEra() === "modern"
    const meta = modern ? { [LOG_LEVEL_META_KEY]: "debug" } : undefined
    const definitions = new Map<string, Tool>()
    if (modern) {
      const capabilities = client.getServerCapabilities()
      const filter = {
        toolsListChanged: capabilities?.tools?.listChanged,
        promptsListChanged: capabilities?.prompts?.listChanged,
        resourcesListChanged: capabilities?.resources?.listChanged,
      } satisfies SubscriptionFilter
      if (filter.toolsListChanged || filter.promptsListChanged || filter.resourcesListChanged) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: (signal) => client.listen(filter, { signal, timeout: catalogTimeout }),
                catch: toError,
              }),
              (subscription) => Effect.promise(() => subscription.close()).pipe(Effect.ignore),
              { interruptible: true },
            )
            const honored = subscription.honoredFilter
            if (
              (filter.toolsListChanged && !honored.toolsListChanged) ||
              (filter.promptsListChanged && !honored.promptsListChanged) ||
              (filter.resourcesListChanged && !honored.resourcesListChanged)
            ) {
              yield* Effect.logWarning("MCP server did not honor all catalog subscriptions", { server })
            }
            const reason = yield* Effect.promise(() => subscription.closed)
            if (reason === "remote") return yield* Effect.fail(new Error("MCP catalog subscription disconnected"))
          }),
        ).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("MCP catalog subscription failed", { server, error: error.message }),
          ),
          Effect.retry(Schedule.spaced("1 second")),
          Effect.forkScoped,
        )
      }
    }
    return {
      instructions: client.getInstructions()?.trim() || undefined,
      tools: () =>
        Effect.gen(function* () {
          if (!client.getServerCapabilities()?.tools) return []
          const tools = yield* Effect.tryPromise({
            try: async (signal) => {
              try {
                return (await client.listTools(undefined, { signal, timeout: catalogTimeout })).tools
              } catch (error) {
                if (!(error instanceof Error) || !isOutputSchemaError(error)) throw error
                return paginate(
                  (cursor) =>
                    client.request(
                      { method: "tools/list", params: cursor === undefined ? undefined : { cursor } },
                      TolerantListToolsResult,
                      {
                        signal,
                        timeout: catalogTimeout,
                      },
                    ),
                  (result) => result.tools,
                )
              }
            },
            catch: toError,
          }).pipe(
            Effect.tapError((error) => Effect.logWarning("failed to list MCP tools", { server, error: error.message })),
          )
          definitions.clear()
          return tools.map((tool) => {
            const definition: Tool = { ...tool }
            // V2 compiles output validators at call time. Check them here so malformed schemas
            // remain usable without catching and potentially replaying a failed tool invocation.
            if (definition.outputSchema !== undefined) {
              try {
                validator.getValidator(definition.outputSchema)
              } catch {
                delete definition.outputSchema
              }
            }
            definitions.set(tool.name, definition)
            return {
              name: definition.name,
              description: definition.description,
              inputSchema: definition.inputSchema,
              outputSchema: definition.outputSchema,
            }
          })
        }),
      prompts: () =>
        Effect.gen(function* () {
          if (!client.getServerCapabilities()?.prompts) return []
          const prompts = yield* Effect.tryPromise({
            try: async (signal) => (await client.listPrompts(undefined, { signal, timeout: catalogTimeout })).prompts,
            catch: toError,
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
            try: async (signal) =>
              (await client.listResources(undefined, { signal, timeout: catalogTimeout })).resources,
            catch: toError,
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
            try: async (signal) =>
              (await client.listResourceTemplates(undefined, { signal, timeout: catalogTimeout })).resourceTemplates,
            catch: toError,
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
            try: (signal) =>
              client.readResource({ uri: input.uri, _meta: meta }, { signal, timeout: executionTimeout }),
            catch: toError,
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
        }).pipe(executionDeadline),
      prompt: (input) =>
        Effect.tryPromise({
          try: (signal) =>
            client.getPrompt(
              { name: input.name, arguments: input.args ?? {}, _meta: meta },
              { signal, timeout: executionTimeout },
            ),
          catch: toError,
        }).pipe(
          executionDeadline,
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
                _meta: input.sessionID === undefined ? meta : { ...meta, sessionID: input.sessionID },
              },
              // Keep progress tokens available while enforcing a hard wall-clock execution timeout.
              { signal, timeout: executionTimeout, onprogress: () => {}, toolDefinition: definitions.get(input.name) },
            ),
          catch: toError,
        }).pipe(
          executionDeadline,
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
      onLog: (callback) => {
        client.setNotificationHandler("notifications/message", (notification) => callback(notification.params))
      },
      onToolsChanged: (callback) => {
        if (!client.getServerCapabilities()?.tools?.listChanged) return
        client.setNotificationHandler("notifications/tools/list_changed", async () => callback())
      },
      onPromptsChanged: (callback) => {
        if (!client.getServerCapabilities()?.prompts?.listChanged) return
        client.setNotificationHandler("notifications/prompts/list_changed", async () => callback())
      },
      onResourcesChanged: (callback) => {
        if (!client.getServerCapabilities()?.resources?.listChanged) return
        client.setNotificationHandler("notifications/resources/list_changed", async () => callback())
      },
    } satisfies Connection
  }

  const error = Cause.squash(exit.cause)
  if (error instanceof UnauthorizedError) return yield* new NeedsAuthError({ server })
  return yield* new ConnectError({ server, message: error instanceof Error ? error.message : String(error) })
})

async function paginate<R extends { nextCursor?: string }, T>(
  list: (cursor: string | undefined) => Promise<R>,
  items: (result: R) => T[],
) {
  const collected: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  while (true) {
    const result = await list(cursor)
    collected.push(...items(result))
    if (result.nextCursor === undefined) return collected
    // A repeating cursor never terminates; bail instead of hanging the connection forever.
    if (seen.has(result.nextCursor)) throw new Error(`MCP list returned duplicate cursor: ${result.nextCursor}`)
    seen.add(result.nextCursor)
    cursor = result.nextCursor
  }
}

const isOutputSchemaError = (error: Error) =>
  /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
