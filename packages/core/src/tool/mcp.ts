export * as McpTool from "./mcp"

import { createHash } from "node:crypto"
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

const MAX_NAME_LENGTH = 64
const HASH_LENGTH = 8

const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_")

// Deterministic short suffix used to keep overlong or colliding names unique and stable across restarts.
const hashSuffix = (raw: string) => "_" + createHash("sha1").update(raw).digest("hex").slice(0, HASH_LENGTH)

const fit = (base: string, raw: string) => base.slice(0, MAX_NAME_LENGTH - HASH_LENGTH - 1) + hashSuffix(raw)

const unique = (initial: string, raw: string, used: Set<string>, prefix = "") => {
  if (!used.has(prefix + initial)) {
    used.add(prefix + initial)
    return initial
  }
  for (let attempt = 0; ; attempt++) {
    const candidate = fit(initial, attempt === 0 ? raw : `${raw}\u0000${attempt}`)
    if (used.has(prefix + candidate)) continue
    used.add(prefix + candidate)
    return candidate
  }
}

const executeSegment = (value: string) => {
  const sanitized = sanitize(value) || "_"
  const safe =
    sanitized === "$codemode" || ["__proto__", "constructor", "prototype"].includes(sanitized)
      ? `_${sanitized}`
      : sanitized
  return safe.length > MAX_NAME_LENGTH ? fit(safe, value) : safe
}

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
        const used = new Set<string>()
        const usedPaths = new Set<string>()
        const record: Record<string, Tool.AnyTool> = {}
        const execute: Record<string, ExecutePath> = {}
        for (const tool of yield* mcp.tools()) {
          const initial = name(tool.server, tool.name)
          const key = unique(initial, `${tool.server}\u0000${tool.name}`, used)
          record[key] = make(tool.server, tool, key)
          const namespace = executeSegment(tool.server)
          const initialMember = executeSegment(tool.name)
          const member = unique(initialMember, `${tool.server}\u0000${tool.name}`, usedPaths, `${namespace}\u0000`)
          execute[key] = [namespace, member]
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
