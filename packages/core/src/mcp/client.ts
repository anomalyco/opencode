export * as MCPClient from "./client"

import path from "node:path"
import { execFile } from "node:child_process"
import { pathToFileURL } from "node:url"
import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  ListRootsRequestSchema,
  ListToolsResultSchema,
  ToolListChangedNotificationSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Cause, Effect, Exit, Schema } from "effect"
import { ConfigMCP } from "../config/mcp"
import { InstallationVersion } from "../installation/version"

const DEFAULT_STARTUP_TIMEOUT = 30_000
const DEFAULT_REQUEST_TIMEOUT = 30_000

type Transport = StdioClientTransport | StreamableHTTPClientTransport

// Some servers advertise tool outputSchemas the SDK's strict validator can't resolve; this drops
// only that field so a single bad schema doesn't blank out the whole tool list.
const TolerantListToolsResult = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

export class NeedsAuthError extends Schema.TaggedErrorClass<NeedsAuthError>()("MCP.NeedsAuthError", {
  server: Schema.String,
}) {}

export class ConnectError extends Schema.TaggedErrorClass<ConnectError>()("MCP.ConnectError", {
  server: Schema.String,
  message: Schema.String,
}) {}

export interface ToolDefinition {
  readonly name: string
  readonly description: string | undefined
  readonly inputSchema: unknown
}

export type CallToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "media"; readonly data: string; readonly mimeType: string }

export interface CallToolResult {
  readonly isError: boolean
  readonly structured: unknown
  readonly content: ReadonlyArray<CallToolContent>
}

/** Handle over a connected MCP server that keeps the SDK `Client` out of the rest of core. */
export interface Connection {
  /** Server-supplied usage instructions from the initialize result, if any. */
  readonly instructions: string | undefined
  /** Lists the server's tools; returns [] when the server doesn't advertise tool support, fails on a transport error. */
  readonly tools: () => Effect.Effect<ToolDefinition[], Error>
  /** Invokes a tool on the server. Interruption aborts the in-flight request. */
  readonly callTool: (input: {
    readonly name: string
    readonly args?: Record<string, unknown>
  }) => Effect.Effect<CallToolResult, Error>
  readonly onClose: (callback: () => void) => void
  /** Registers a callback fired when the server announces its tool list changed; no-op if unsupported. */
  readonly onToolsChanged: (callback: () => void) => void
}

/** Connects an MCP server; closing the calling scope tears down the transport and any spawned process. */
export const connect = Effect.fnUntraced(function* (
  server: string,
  config: typeof ConfigMCP.Server.Type,
  directory: string,
) {
  const transport: Transport = yield* Effect.gen(function* () {
    if (config.type === "local") {
      const [command, ...args] = config.command
      return new StdioClientTransport({
        command,
        args,
        cwd: config.cwd ? path.resolve(directory, config.cwd) : directory,
        stderr: "pipe",
        env: {
          ...(process.env as Record<string, string>),
          ...(command === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...config.environment,
        },
      })
    }
    if (!URL.canParse(config.url)) return yield* new ConnectError({ server, message: `Invalid MCP URL for "${server}"` })
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    })
  })
  const client = new Client(
    { name: "opencode", version: InstallationVersion },
    {
      capabilities: {
        // https://github.com/anomalyco/opencode/issues/2308
        roots: {},
      },
    },
  )
  client.setRequestHandler(ListRootsRequestSchema, () =>
    Promise.resolve({ roots: [{ uri: pathToFileURL(directory).href }] }),
  )

  const exit = yield* Effect.tryPromise({
    try: (signal) => client.connect(transport, { timeout: config.timeout?.startup ?? DEFAULT_STARTUP_TIMEOUT, signal }),
    catch: (error) => error,
  }).pipe(Effect.exit)
  if (Exit.isSuccess(exit)) {
    yield* Effect.addFinalizer(() =>
      cleanupStdioDescendants(transport).pipe(
        Effect.andThen(Effect.promise(() => client.close())),
        Effect.ignore,
      ),
    )
    const requestTimeout = config.timeout?.request ?? DEFAULT_REQUEST_TIMEOUT
    return {
      instructions: client.getInstructions()?.trim() || undefined,
      tools: () =>
        Effect.gen(function* () {
          if (!client.getServerCapabilities()?.tools) return []
          const tools = yield* Effect.tryPromise({
            try: () =>
              paginate(
                async (cursor) => {
                  const params = cursor === undefined ? undefined : { cursor }
                  try {
                    return await client.listTools(params, { timeout: requestTimeout })
                  } catch (error) {
                    if (!(error instanceof Error) || !isOutputSchemaError(error)) throw error
                    return client.request({ method: "tools/list", params }, TolerantListToolsResult, {
                      timeout: requestTimeout,
                    })
                  }
                },
                (result) => result.tools,
              ),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }).pipe(
            Effect.tapError((error) => Effect.logWarning("failed to list MCP tools", { server, error: error.message })),
          )
          return tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }))
        }),
      callTool: (input) =>
        Effect.tryPromise({
          try: (signal) =>
            client.callTool(
              { name: input.name, arguments: input.args ?? {} },
              CallToolResultSchema,
              // The SDK only sends a progress token when onprogress is present, which enables timeout resets.
              { signal, timeout: requestTimeout, resetTimeoutOnProgress: true, onprogress: () => {} },
            ),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
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
      onToolsChanged: (callback) => {
        if (!client.getServerCapabilities()?.tools?.listChanged) return
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => callback())
      },
    } satisfies Connection
  }

  yield* cleanupStdioDescendants(transport).pipe(
    Effect.andThen(Effect.promise(() => transport.close())),
    Effect.ignore,
  )
  const error = Cause.squash(exit.cause)
  if (error instanceof UnauthorizedError || (error instanceof Error && error.message.includes("OAuth")))
    return yield* new NeedsAuthError({ server })
  return yield* new ConnectError({ server, message: error instanceof Error ? error.message : String(error) })
})

// SDK close stops the MCP process, but not child processes it spawned.
const cleanupStdioDescendants = (transport: Transport) =>
  Effect.gen(function* () {
    if (!(transport instanceof StdioClientTransport)) return
    const pid = transport.pid
    if (typeof pid !== "number") return
    yield* Effect.forEach(
      yield* descendantPids(pid),
      (pid) =>
        Effect.try({
          try: () => process.kill(pid, "SIGTERM"),
          catch: () => undefined,
        }).pipe(Effect.ignore),
      { discard: true },
    )
  })

const descendantPids = Effect.fnUntraced(function* (root: number) {
  if (process.platform === "win32") return []
  const result: number[] = []
  const queue = [root]
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]
    if (parent === undefined) return result
    const children = (yield* childPids(parent)).filter((pid) => !result.includes(pid))
    result.push(...children)
    queue.push(...children)
  }
  return result
})

const childPids = (pid: number) =>
  Effect.promise(
    () =>
      new Promise<number[]>((resolve) => {
        execFile("pgrep", ["-P", String(pid)], { encoding: "utf8" }, (_error, stdout) => {
          resolve(
            stdout
              .split("\n")
              .map((line) => Number.parseInt(line, 10))
              .filter((pid) => Number.isInteger(pid)),
          )
        })
      }),
  )

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
