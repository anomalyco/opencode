export * as McpTool from "./mcp"

import { ToolFailure } from "@opencode-ai/llm"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, Exit, Scope, Semaphore, Stream } from "effect"
import { EventV2 } from "../event"
import { Flag } from "../flag/flag"
import { MCP } from "../mcp"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"

export const Plugin = {
  id: "core-mcp-tools",
  effect: Effect.fn("McpTool.Plugin")(function* (ctx: PluginContext) {
    const mcp = yield* MCP.Service
    const events = yield* EventV2.Service
    const permission = yield* PermissionV2.Service
    const scope = yield* Scope.Scope
    const lock = Semaphore.makeUnsafe(1)
    let current: Scope.Closeable | undefined

    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        const items = (yield* mcp.tools()).map(
          (item) =>
            [
              item,
              Tool.withPermission(
                Tool.make({
                  description: item.description ?? "",
                  jsonSchema:
                    typeof item.inputSchema === "object" &&
                    item.inputSchema !== null &&
                    !Array.isArray(item.inputSchema)
                      ? { ...item.inputSchema }
                      : { type: "object", properties: {} },
                  execute: (input, context) =>
                    Effect.gen(function* () {
                      const args =
                        typeof input === "object" && input !== null && !Array.isArray(input) ? { ...input } : {}
                      yield* permission
                        .assert({
                          sessionID: context.sessionID,
                          agent: context.agent,
                          action: `mcp:${item.server}:${item.name}`,
                          resources: ["*"],
                          save: ["*"],
                          metadata: { server: item.server, tool: item.name, arguments: args },
                          source: {
                            type: "tool",
                            messageID: context.assistantMessageID,
                            callID: context.toolCallID,
                          },
                        })
                        .pipe(
                          Effect.mapError(
                            (error) =>
                              new ToolFailure({
                                message:
                                  error instanceof PermissionV2.CorrectedError ? error.feedback : "Permission denied",
                              }),
                          ),
                        )
                      const result = yield* mcp.callTool({ server: item.server, name: item.name, args }).pipe(
                        Effect.catchTags({
                          "MCP.NotFoundError": (error) =>
                            new ToolFailure({ message: `MCP server "${error.server}" is not available` }),
                          "MCP.ToolCallError": (error) => new ToolFailure({ message: error.message }),
                        }),
                      )
                      const text = result.content
                        .flatMap((part) => (part.type === "text" ? [part.text] : []))
                        .join("\n")
                        .trim()
                      if (result.isError)
                        return yield* new ToolFailure({ message: text || "MCP tool returned an error" })
                      const media = result.content.filter((part) => part.type === "media").length
                      return {
                        structured:
                          result.structured !== undefined
                            ? result.structured
                            : media === 0
                              ? text
                              : [text, `[${media} media attachment${media === 1 ? "" : "s"}]`]
                                  .filter(Boolean)
                                  .join("\n"),
                        content: result.content.map((part) =>
                          part.type === "text"
                            ? { type: "text" as const, text: part.text }
                            : { type: "file" as const, data: part.data, mime: part.mimeType },
                        ),
                      }
                    }),
                }),
                `mcp:${item.server}:${item.name}`,
              ),
            ] as const,
        )
        const next = yield* Scope.fork(scope)
        yield* (
          Flag.OPENCODE_CODE_MODE
            ? ctx.tool.execute.register(
                Object.fromEntries(
                  Array.from(new Set(items.map(([item]) => item.server))).map((server) => [
                    server,
                    Object.fromEntries(
                      items.filter(([item]) => item.server === server).map(([item, tool]) => [item.name, tool]),
                    ),
                  ]),
                ),
              )
            : ctx.tool.register(Object.fromEntries(items.map(([item, tool]) => [`${item.server}_${item.name}`, tool])))
        ).pipe(Scope.provide(next), Effect.orDie)
        if (current) yield* Scope.close(current, Exit.void)
        current = next
      }),
    )

    yield* events.subscribe(McpEvent.ToolsChanged).pipe(
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* reconcile
  }),
}
