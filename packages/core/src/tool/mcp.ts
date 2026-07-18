export * as McpTool from "./mcp"

import { ToolFailure } from "@opencode-ai/ai"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, Exit, type JsonSchema, Layer, Scope, Semaphore, Stream } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"

import { MCP } from "../mcp"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

/**
 * Registry namespace and permission action names for MCP tools.
 */
export const namespace = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")
export const name = (server: string, tool: string) =>
  `${namespace(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

/**
 * Runtime MCP bridge. The daemon has two MCP services (@opencode/MCP and
 * @opencode/v2/MCP) in independent layer graphs. Runtime-added entries
 * live in the former, but the SessionRunner reads tools from the latter.
 * This shared in-process registry lets the runtime side inject tools
 * that the core reconciler below will pick up on the next fire.
 *
 * The opencode-side MCP publishes McpEvent.ToolsChanged after a runtime
 * add succeeds; that event triggers the reconcile which reads both
 * MCP.Service.tools() and Runtime.list().
 */
export interface RuntimeToolEntry {
  readonly name: string
  readonly description?: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly execute: (args: Record<string, unknown>) => Promise<{
    readonly isError: boolean
    readonly structured?: unknown
    readonly content: ReadonlyArray<
      | { readonly type: "text"; readonly text: string }
      | { readonly type: "file"; readonly data: string; readonly mime?: string }
    >
  }>
}

const runtimeServers = new Map<string, ReadonlyArray<RuntimeToolEntry>>()

export const Runtime = {
  set(server: string, tools: ReadonlyArray<RuntimeToolEntry>): void {
    runtimeServers.set(server, tools)
  },
  remove(server: string): void {
    runtimeServers.delete(server)
  },
  list(): ReadonlyMap<string, ReadonlyArray<RuntimeToolEntry>> {
    return runtimeServers
  },
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const tools = yield* Tools.Service
    const events = yield* EventV2.Service
    const permission = yield* PermissionV2.Service
    const scope = yield* Scope.Scope
    const lock = Semaphore.makeUnsafe(1)
    let current: Scope.Closeable | undefined

    // Register the current tool set under a fresh child scope, then close the previous one so the
    // registry never has a gap where MCP tools disappear mid-swap.
    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        const groups = new Map<string, Record<string, Tool.AnyTool>>()
        for (const tool of yield* mcp.tools()) {
          const group = groups.get(tool.server) ?? {}
          const schema = (tool.inputSchema ?? {}) as JsonSchema.JsonSchema
          group[tool.name] = Tool.withPermission(
            Tool.make({
              description: tool.description ?? "",
              jsonSchema: {
                ...schema,
                type: "object",
                properties: schema.properties ?? {},
                additionalProperties: false,
              },
              outputSchema: tool.outputSchema as JsonSchema.JsonSchema | undefined,
              execute: (input, context) =>
                Effect.gen(function* () {
                  yield* permission.assert({
                    action: name(tool.server, tool.name),
                    resources: ["*"],
                    save: ["*"],
                    metadata: {},
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: {
                      type: "tool",
                      messageID: context.messageID,
                      callID: context.callID,
                    },
                  })
                  const result = yield* mcp
                    .callTool({
                      server: tool.server,
                      name: tool.name,
                      args: (input ?? {}) as Record<string, unknown>,
                    })
                    .pipe(
                      Effect.catchTags({
                        "MCP.NotFoundError": (error) =>
                          new ToolFailure({ message: `MCP server "${error.server}" is not available` }),
                        "MCP.ToolCallError": (error) => new ToolFailure({ message: error.message }),
                      }),
                    )
                  if (result.isError)
                    return yield* new ToolFailure({
                      message:
                        result.content
                          .flatMap((part) => (part.type === "text" ? [part.text] : []))
                          .join("\n")
                          .trim() || "MCP tool returned an error",
                    })
                  const content = result.content.map((part) =>
                    part.type === "text"
                      ? { type: "text" as const, text: part.text }
                      : { type: "file" as const, data: part.data, mime: part.mimeType },
                  )
                  const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                  return {
                    structured: result.structured ?? (text === "" ? null : text),
                    content,
                  }
                }).pipe(
                  Effect.mapError((error) =>
                    error instanceof ToolFailure
                      ? error
                      : new ToolFailure({ message: `Unable to execute ${name(tool.server, tool.name)}` }),
                  ),
                ),
            }),
            name(tool.server, tool.name),
          )
          groups.set(tool.server, group)
        }

        // Also register runtime-bridge tools published by the opencode-side
        // MCP service (see Runtime block above). Same shape, different source.
        for (const [server, entries] of Runtime.list()) {
          const group = groups.get(server) ?? {}
          for (const tool of entries) {
            const schema = (tool.inputSchema ?? {}) as JsonSchema.JsonSchema
            group[tool.name] = Tool.withPermission(
              Tool.make({
                description: tool.description ?? "",
                jsonSchema: {
                  ...schema,
                  type: "object",
                  properties: schema.properties ?? {},
                  additionalProperties: false,
                },
                outputSchema: tool.outputSchema,
                execute: (input, context) =>
                  Effect.gen(function* () {
                    yield* permission.assert({
                      action: name(server, tool.name),
                      resources: ["*"],
                      save: ["*"],
                      metadata: {},
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source: {
                        type: "tool",
                        messageID: context.messageID,
                        callID: context.callID,
                      },
                    })
                    const result = yield* Effect.tryPromise({
                      try: () => tool.execute((input ?? {}) as Record<string, unknown>),
                      catch: (e) =>
                        new ToolFailure({ message: e instanceof Error ? e.message : String(e) }),
                    })
                    if (result.isError)
                      return yield* new ToolFailure({
                        message:
                          result.content
                            .flatMap((part) => (part.type === "text" ? [part.text] : []))
                            .join("\n")
                            .trim() || "MCP tool returned an error",
                      })
                    const content = result.content.map((part) =>
                      part.type === "text"
                        ? { type: "text" as const, text: part.text }
                        : { type: "file" as const, data: part.data, mime: part.mime ?? "application/octet-stream" },
                    )
                    const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                    return {
                      structured: result.structured ?? (text === "" ? null : text),
                      content,
                    }
                  }).pipe(
                    Effect.mapError((error) =>
                      error instanceof ToolFailure
                        ? error
                        : new ToolFailure({ message: `Unable to execute ${name(server, tool.name)}` }),
                    ),
                  ),
              }),
              name(server, tool.name),
            )
          }
          groups.set(server, group)
        }

        const next = yield* Scope.fork(scope)
        yield* Effect.forEach(
          groups,
          ([server, record]) => tools.register(record, { namespace: namespace(server) }),
          {
            discard: true,
          },
        ).pipe(Scope.provide(next), Effect.orDie)
        if (current) yield* Scope.close(current, Exit.void)
        current = next
      }),
    )

    yield* reconcile.pipe(Effect.forkScoped)
    yield* events.subscribe(McpEvent.ToolsChanged).pipe(
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
)

export const node = makeLocationNode({
  name: "mcp-tools",
  layer,
  deps: [ToolRegistry.toolsNode, MCP.node, EventV2.node, PermissionV2.node],
})
