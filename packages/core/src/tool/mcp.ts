export * as McpTool from "./mcp"

import { ToolFailure } from "@opencode-ai/ai"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, Exit, type JsonSchema, Layer, Scope, Semaphore, Stream } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../bus"

import { MCP } from "../mcp"
import { Permission } from "../permission"
import { Tool } from "../tool"

/**
 * Registry namespace and permission action names for MCP tools.
 */
export const namespace = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")
export const name = (server: string, tool: string) => `${namespace(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const tools = yield* Tool.Service
    const bus = yield* Bus.Service
    const permission = yield* Permission.Service
    const scope = yield* Scope.Scope
    const lock = Semaphore.makeUnsafe(1)
    let current: Scope.Closeable | undefined

    // Register the current tool set under a fresh child scope, then close the previous one so the
    // registry never has a gap where MCP tools disappear mid-swap.
    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        const discovered = yield* mcp.tools()
        const next = yield* Scope.fork(scope)
        yield* tools
          .transform((draft) => {
            for (const tool of discovered) {
              const schema = (tool.inputSchema ?? {}) as JsonSchema.JsonSchema
              draft.add({
                name: tool.name,
                options: { namespace: namespace(tool.server), codemode: tool.codemode !== false },
                description: tool.description ?? "",
                input: {
                  ...schema,
                  type: "object",
                  properties: schema.properties ?? {},
                  additionalProperties: false,
                },
                output: (tool.outputSchema ?? {}) as JsonSchema.JsonSchema,
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
                    : {
                        type: "file" as const,
                        uri: `data:${part.mimeType};base64,${part.data}`,
                        mime: part.mimeType,
                      },
                )
                const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                return {
                  output: result.structured ?? (text === "" ? null : text),
                  ...(content.length === 0 ? {} : { content }),
                }
                  }).pipe(
                    Effect.mapError((error) =>
                      error instanceof ToolFailure
                        ? error
                        : new ToolFailure({ message: `Unable to execute ${name(tool.server, tool.name)}` }),
                    ),
                  ),
              })
            }
          })
          .pipe(Scope.provide(next), Effect.orDie)
        if (current) yield* Scope.close(current, Exit.void)
        current = next
      }),
    )

    yield* reconcile.pipe(Effect.forkScoped)
    yield* bus.subscribe(McpEvent.ToolsChanged).pipe(
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
)

export const node = makeLocationNode({
  name: "mcp-tools",
  layer,
  deps: [Tool.node, MCP.node, Bus.node, Permission.node],
})
