export * as McpToolPlugin from "./mcp.js"

import type { Context } from "@opencode-ai/plugin/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, type JsonSchema, PubSub, Semaphore, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Mcp } from "../../mcp/index.js"
import { Permission } from "../../permission.js"
import { McpTool } from "../mcp.js"

export const Plugin = {
  id: "opencode.tool.mcp",
  effect: Effect.fn("McpToolPlugin.Plugin")(function* (ctx: Context) {
    const mcp = yield* Mcp.Service
    const tools = ctx.tool
    const readiness = yield* McpTool.Service
    const bus = yield* Bus.Service
    const permission = yield* Permission.Service
    const lock = Semaphore.makeUnsafe(1)
    let discovered: Mcp.Tool[] = []

    // Reserve precedence before discovery yields so later plugins can override or remove tools.
    yield* tools.transform((editor) => {
      for (const tool of discovered) {
        const schema = (tool.inputSchema ?? {}) as JsonSchema.JsonSchema
        editor.add({
          name: tool.name,
          options: { namespace: McpTool.namespace(tool.server), codemode: tool.codemode !== false },
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
                action: McpTool.name(tool.server, tool.name),
                resources: ["*"],
                save: ["*"],
                metadata: {},
                sessionID: context.sessionID,
                agent: context.agent,
                source: {
                  type: "tool",
                  messageID: context.messageID,
                  id: context.id,
                },
              })
              const result = yield* mcp
                .callTool({
                  server: tool.server,
                  name: tool.name,
                  args: (input ?? {}) as Record<string, unknown>,
                  sessionID: context.sessionID,
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
                  : new ToolFailure({ message: `Unable to execute ${McpTool.name(tool.server, tool.name)}` }),
              ),
            ),
        })
      }
    })
    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        discovered = yield* mcp.tools()
        yield* tools.reload()
      }),
    )

    // Servers announce tools in bursts and each read loads the whole catalog, so settle and refresh
    // once. The bus subscription stays eager; only the already-open sliding subscription is debounced.
    const changes = yield* PubSub.sliding<void>(1)
    yield* bus.subscribe(McpEvent.ToolsChanged).pipe(
      Stream.runForEach(() => PubSub.publish(changes, undefined)),
      Effect.forkScoped({ startImmediately: true }),
    )
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* readiness.start(
      lock.withPermit(
        Effect.gen(function* () {
          discovered = yield* mcp.tools()
          yield* tools.reload()
        }),
      ),
    )
  }),
}
