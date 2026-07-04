export * as McpTool from "./mcp"

import { ToolFailure } from "@opencode-ai/llm"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, Exit, type JsonSchema, Layer, Scope, Semaphore, Stream } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Flag } from "../flag/flag"
import { MCP } from "../mcp"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

/**
 * Registry group and permission action names for MCP tools.
 */
export const group = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")
export const name = (server: string, tool: string) => `${group(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

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
                      messageID: context.assistantMessageID,
                      callID: context.toolCallID,
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
        const next = yield* Scope.fork(scope)
        yield* Effect.forEach(
          groups,
          ([group, record]) => tools.register(record, { group, deferred: Flag.CODEMODE_ENABLED }),
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
