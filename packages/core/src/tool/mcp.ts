export * as McpTool from "./mcp.js"

import { ToolFailure } from "@opencode/ai"
import { McpEvent } from "@opencode/schema/mcp-event"
import type { Session } from "@opencode/schema/session"
import type { McpSession } from "../mcp/session.js"
import { Context, Effect, Fiber, type JsonSchema, Layer, PubSub, Semaphore, Stream } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"

import { Mcp } from "../mcp/index.js"
import { Permission } from "../permission.js"
import { Tool } from "../tool.js"

/**
 * Registry namespace and permission action names for MCP tools.
 */
export const namespace = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")
export const name = (server: string, tool: string) => `${namespace(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

export interface Interface {
  /** Wait for the initial MCP tool registration to settle. */
  readonly flush: Effect.Effect<void>
  /** Session-owned server tools from a Session's MCP view, hiding the Location server tools they shadow. */
  readonly overlay: (view: Pick<McpSession.View, "shadowed" | "owned">) => Effect.Effect<Tool.Overlay | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpTool") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const tools = yield* Tool.Service
    const bus = yield* Bus.Service
    const permission = yield* Permission.Service
    const lock = Semaphore.makeUnsafe(1)
    let discovered: Mcp.Tool[] = []

    // Keyed by the MCP tool object so unchanged tools keep their identity across snapshots. A tool object
    // belongs to exactly one server entry, so the first call bound to it stays valid.
    const infos = new WeakMap<Mcp.Tool, Tool.Info>()
    const info = (
      tool: Mcp.Tool,
      call: (input: {
        readonly args: Record<string, unknown>
        readonly sessionID: Session.ID
      }) => Effect.Effect<Mcp.ToolResult, Mcp.NotFoundError | Mcp.ToolCallError>,
    ) => {
      const cached = infos.get(tool)
      if (cached) return cached
      const created: Tool.Info = {
        name: tool.name,
        options: { namespace: namespace(tool.server), codemode: tool.codemode !== false },
        description: tool.description ?? "",
        input: (tool.inputSchema ?? { type: "object", properties: {} }) as JsonSchema.JsonSchema,
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
                id: context.id,
              },
            })
            const result = yield* call({
              args: (input ?? {}) as Record<string, unknown>,
              sessionID: context.sessionID,
            }).pipe(
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
            const output = () => {
              if (result.structured !== undefined) return result.structured
              if (text === "") return null
              // Agents assume JSON returned as text is already an object, so parse it when the server declares no schema.
              if (tool.outputSchema === undefined && (text.startsWith("{") || text.startsWith("["))) {
                try {
                  return JSON.parse(text)
                } catch {}
              }
              return text
            }
            return {
              output: output(),
              ...(content.length === 0 ? {} : { content }),
            }
          }).pipe(
            Effect.mapError((error) =>
              error instanceof ToolFailure
                ? error
                : new ToolFailure({ message: `Unable to execute ${name(tool.server, tool.name)}` }),
            ),
          ),
      }
      infos.set(tool, created)
      return created
    }

    // Register once after initial discovery; only subsequent updates need a debounced reload.
    const initial = yield* lock
      .withPermit(
        Effect.gen(function* () {
          discovered = yield* mcp.tools()
          yield* tools.transform((editor) => {
            for (const tool of discovered)
              editor.add(info(tool, (input) => mcp.callTool({ ...input, server: tool.server, name: tool.name })))
          })
        }),
      )
      .pipe(Effect.forkScoped)
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
    return Service.of({
      flush: Effect.asVoid(Fiber.await(initial)),
      overlay: (view) =>
        lock.withPermit(
          Effect.sync(() => {
            const hidden = new Set(
              discovered.filter((tool) => view.shadowed.has(tool.server)).map((tool) => name(tool.server, tool.name)),
            )
            if (view.owned.length === 0 && hidden.size === 0) return undefined
            return { tools: view.owned.map((owned) => info(owned.tool, owned.call)), hidden }
          }),
        ),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Tool.node, Mcp.node, Bus.node, Permission.node],
})
