export * as McpTool from "./mcp"

import { ToolFailure } from "@opencode-ai/llm"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, Exit, Layer, Scope, Semaphore, Stream } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Flag } from "../flag/flag"
import { MCP } from "../mcp"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools, type ExecutePath } from "./tools"
import { ToolRegistry } from "./registry"

const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_")

/**
 * V1-compatible registry and permission name: `<server>_<tool>` with unsupported characters replaced.
 */
export const name = (server: string, tool: string) => sanitize(server) + "_" + sanitize(tool)

const toContent = (part: MCP.ToolResultContent): Tool.Content =>
  part.type === "text" ? { type: "text", text: part.text } : { type: "file", data: part.data, mime: part.mimeType }

const errorText = (content: ReadonlyArray<MCP.ToolResultContent>) =>
  content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const tools = yield* Tools.Service
    const events = yield* EventV2.Service
    const permission = yield* PermissionV2.Service
    const scope = yield* Scope.Scope
    const lock = Semaphore.makeUnsafe(1)
    let current: Scope.Closeable | undefined

    const make = (server: MCP.ServerName, tool: MCP.Tool, action: string) =>
      Tool.withPermission(
        Tool.make({
          description: tool.description ?? "",
          jsonSchema:
            typeof tool.inputSchema === "object" && tool.inputSchema !== null && !Array.isArray(tool.inputSchema)
              ? { ...tool.inputSchema }
              : { type: "object", properties: {} },
          execute: (input, context) =>
            Effect.gen(function* () {
              const args = typeof input === "object" && input !== null && !Array.isArray(input) ? { ...input } : {}
              yield* permission
                .assert({
                  sessionID: context.sessionID,
                  agent: context.agent,
                  action,
                  resources: ["*"],
                  save: ["*"],
                  metadata: { server, tool: tool.name, arguments: args },
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                .pipe(
                  Effect.mapError(
                    (error) =>
                      new ToolFailure({
                        message: error instanceof PermissionV2.CorrectedError ? error.feedback : "Permission denied",
                      }),
                  ),
                )
              const result = yield* mcp.callTool({ server, name: tool.name, args }).pipe(
                Effect.catchTags({
                  "MCP.NotFoundError": (error) =>
                    new ToolFailure({ message: `MCP server "${error.server}" is not available` }),
                  "MCP.ToolCallError": (error) => new ToolFailure({ message: error.message }),
                }),
              )
              if (result.isError)
                return yield* new ToolFailure({ message: errorText(result.content) || "MCP tool returned an error" })
              return {
                structured: result.structured !== undefined ? result.structured : errorText(result.content),
                content: result.content.map(toContent),
              }
            }),
        }),
        action,
      )

    // Register the current tool set under a fresh child scope, then close the previous one so the
    // registry never has a gap where MCP tools disappear mid-swap.
    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        const record: Record<string, Tool.AnyTool> = {}
        const execute: Record<string, ExecutePath> = {}
        for (const tool of yield* mcp.tools()) {
          const key = name(tool.server, tool.name)
          record[key] = make(tool.server, tool, key)
          execute[key] = [sanitize(tool.server), sanitize(tool.name)]
        }
        const next = yield* Scope.fork(scope)
        yield* tools
          .register(record, Flag.OPENCODE_CODE_MODE ? { execute } : undefined)
          .pipe(Scope.provide(next), Effect.orDie)
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
