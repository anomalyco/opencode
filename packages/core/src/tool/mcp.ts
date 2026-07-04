export * as McpTool from "./mcp"

import { createHash } from "node:crypto"
import { ToolFailure } from "@opencode-ai/llm"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, Exit, type JsonSchema, Layer, Scope, Semaphore, Stream } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { MCP } from "../mcp"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

const MAX_NAME_LENGTH = 64
const HASH_LENGTH = 8

const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_")

// Deterministic short suffix used to keep overlong or colliding names unique and stable across restarts.
const hashSuffix = (raw: string) => "_" + createHash("sha1").update(raw).digest("hex").slice(0, HASH_LENGTH)

const fit = (base: string, raw: string) => base.slice(0, MAX_NAME_LENGTH - HASH_LENGTH - 1) + hashSuffix(raw)

/**
 * Registry/permission action name for an MCP tool: V1-compatible `<server>_<tool>` so existing deny
 * rules keep working. Sanitized to a valid tool name, prefixed when it would not start with a letter,
 * and hashed down when it would exceed the 64-char limit.
 */
export const name = (server: string, tool: string) => {
  const joined = sanitize(server) + "_" + sanitize(tool)
  const base = /^[A-Za-z]/.test(joined) ? joined : "mcp_" + joined
  return base.length > MAX_NAME_LENGTH ? fit(base, `${server}\u0000${tool}`) : base
}

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
    const scope = yield* Scope.Scope
    const lock = Semaphore.makeUnsafe(1)
    let current: Scope.Closeable | undefined

    const make = (server: MCP.ServerName, tool: MCP.Tool) =>
      Tool.make({
        description: tool.description ?? "",
        jsonSchema: (tool.inputSchema as JsonSchema.JsonSchema | undefined) ?? { type: "object", properties: {} },
        execute: (input) =>
          Effect.gen(function* () {
            const result = yield* mcp.callTool({ server, name: tool.name, args: (input ?? {}) as Record<string, unknown> }).pipe(
              Effect.catchTags({
                "MCP.NotFoundError": (error) => new ToolFailure({ message: `MCP server "${error.server}" is not available` }),
                "MCP.ToolCallError": (error) => new ToolFailure({ message: error.message }),
              }),
            )
            if (result.isError)
              return yield* new ToolFailure({ message: errorText(result.content) || "MCP tool returned an error" })
            return { structured: result.structured ?? {}, content: result.content.map(toContent) }
          }),
      })

    // Register the current tool set under a fresh child scope, then close the previous one so the
    // registry never has a gap where MCP tools disappear mid-swap.
    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        const used = new Set<string>()
        const record: Record<string, Tool.AnyTool> = {}
        for (const tool of yield* mcp.tools()) {
          const initial = name(tool.server, tool.name)
          const key = used.has(initial) ? fit(initial, `${tool.server}\u0000${tool.name}`) : initial
          used.add(key)
          record[key] = make(tool.server, tool)
        }
        const next = yield* Scope.fork(scope)
        yield* tools.register(record).pipe(Scope.provide(next), Effect.orDie)
        if (current) yield* Scope.close(current, Exit.void)
        current = next
      }),
    )

    yield* reconcile.pipe(Effect.forkScoped)
    yield* events
      .subscribe(McpEvent.ToolsChanged)
      .pipe(Stream.runForEach(() => reconcile), Effect.forkScoped({ startImmediately: true }))
  }),
)

export const node = makeLocationNode({
  name: "mcp-tools",
  layer,
  deps: [ToolRegistry.toolsNode, MCP.node, EventV2.node],
})
