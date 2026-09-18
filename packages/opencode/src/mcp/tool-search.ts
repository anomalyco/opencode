import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { MCP } from "./index"
import { Permission } from "@/permission"
import { InstanceState } from "@/effect/instance-state"
import type { SessionID } from "@/session/schema"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

// Auto-enables once the visible MCP surface is large enough that the schemas
// dominate a small model's prompt prefix.
const AUTO_MIN_TOOLS = 8

export interface Match {
  /** Fully-qualified registry id, e.g. `github_create_issue`. */
  id: string
  description: string
  server: string
}

export interface Interface {
  /**
   * Whether tool search is active for the given server, given the global setting.
   * `surfaceSize` lets callers that already computed the visible-tool count avoid
   * a redundant catalog rebuild on the "auto" path.
   */
  readonly enabledFor: (server: string, surfaceSize?: number) => Effect.Effect<boolean>
  /** All connected MCP tools, minus those hidden by permission, grouped for search. */
  readonly catalog: (
    ruleset: PermissionV1.Ruleset,
  ) => Effect.Effect<Record<string, MCP.McpTool>>
  /** Search the catalog; returns ranked matches. Marks them resolved for the session. */
  readonly search: (input: {
    sessionID: SessionID
    query: string
    ruleset: PermissionV1.Ruleset
    limit?: number
  }) => Effect.Effect<Match[]>
  /** Session-scoped set of tool ids whose full schema should be registered. */
  readonly resolved: (sessionID: SessionID) => Effect.Effect<ReadonlySet<string>>
  /** Explicitly mark ids resolved (used on first direct call). Returns the newly-added ids. */
  readonly markResolved: (sessionID: SessionID, ids: string[]) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpToolSearch") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service

    // Session-scoped resolved sets live for the process lifetime; sessions are
    // not re-keyed, so a plain map is fine and needs no eviction beyond the
    // instance finalizer.
    const state = yield* InstanceState.make(
      Effect.fn("McpToolSearch.state")(() => Effect.succeed(new Map<SessionID, Set<string>>())),
    )

    const catalog: Interface["catalog"] = Effect.fn("McpToolSearch.catalog")(function* (ruleset) {
      const all = yield* mcp.tools()
      return Permission.visibleTools(all, ruleset)
    })

    const enabledFor: Interface["enabledFor"] = Effect.fn("McpToolSearch.enabledFor")(function* (
      server,
      surfaceSize,
    ) {
      const cfg = yield* config.get()
      const entry = cfg.mcp?.[server]
      const override =
        entry && typeof entry === "object" && "tool_search" in entry
          ? (entry as { tool_search?: "auto" | "always" | "off" }).tool_search
          : undefined
      const setting = override ?? cfg.mcp_tool_search ?? "off"
      if (setting === "off") return false
      if (setting === "always") return true
      const visible = surfaceSize ?? Object.keys(yield* catalog([])).length
      return visible >= AUTO_MIN_TOOLS
    })

    const resolved: Interface["resolved"] = Effect.fn("McpToolSearch.resolved")(function* (sessionID) {
      const s = yield* InstanceState.get(state)
      return s.get(sessionID) ?? new Set<string>()
    })

    const markResolved: Interface["markResolved"] = Effect.fn("McpToolSearch.markResolved")(function* (
      sessionID,
      ids,
    ) {
      if (ids.length === 0) return []
      const s = yield* InstanceState.get(state)
      const set = s.get(sessionID) ?? new Set<string>()
      const fresh = ids.filter((id) => !set.has(id))
      for (const id of fresh) set.add(id)
      s.set(sessionID, set)
      return fresh
    })

    const search: Interface["search"] = Effect.fn("McpToolSearch.search")(function* (input) {
      const query = input.query.toLowerCase().trim()
      const terms = query.split(/\s+/).filter(Boolean)
      // A blank query must not match everything: every visible tool would score
      // 1 and the whole catalog would be marked resolved.
      if (terms.length === 0) return []
      const visible = yield* catalog(input.ruleset)
      const limit = input.limit ?? 10

      const scored = Object.entries(visible)
        .map(([id, tool]) => {
          const description = tool.def.description ?? ""
          const haystack = `${id} ${description}`.toLowerCase()
          const score = terms.reduce((acc, term) => {
            if (id.toLowerCase() === term) return acc + 100
            if (id.toLowerCase().includes(term)) return acc + 10
            if (haystack.includes(term)) return acc + 1
            return acc
          }, 0)
          return { id, description, server: tool.server, score }
        })
        .filter((entry) => entry.score > 0)

      scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      const matches = scored.slice(0, limit).map((entry) => ({
        id: entry.id,
        description: entry.description,
        server: entry.server,
      }))
      yield* markResolved(input.sessionID, matches.map((m) => m.id))
      return matches
    })

    return Service.of({ enabledFor, catalog, search, resolved, markResolved })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, MCP.node, Permission.node],
})

export * as McpToolSearch from "./tool-search"
