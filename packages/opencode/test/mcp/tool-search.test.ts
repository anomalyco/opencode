import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { McpToolSearch } from "@/mcp/tool-search"
import { MCP } from "@/mcp"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { afterEach } from "bun:test"

const sid = SessionID.make("ses_tool_search")

function tool(server: string, name: string, description: string): MCP.McpTool {
  return {
    def: { name, description, inputSchema: { type: "object", properties: {} } } as MCPToolDef,
    client: {} as MCP.McpTool["client"],
    server,
  }
}

function catalog(entries: Record<string, MCP.McpTool>) {
  return Layer.mock(MCP.Service, {
    tools: () => Effect.succeed(entries),
    clients: () => Effect.succeed({}),
  })
}

function withConfig(mcpConfig: ConfigV1.Info["mcp"], mcp_tool_search?: ConfigV1.Info["mcp_tool_search"]) {
  return TestConfig.layer({
    get: () => Effect.succeed({ mcp: mcpConfig, mcp_tool_search }),
  })
}

function harness(config: Layer.Layer<Config.Service>, mcp: Layer.Layer<MCP.Service>) {
  return testEffect(
    LayerNode.compile(LayerNode.group([McpToolSearch.node]), [
      [Config.node, config],
      [MCP.node, mcp],
    ]),
  )
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("mcp tool search", () => {
  harness(
    withConfig({}, "always"),
    catalog({ github_create_issue: tool("github", "create_issue", "Create a GitHub issue") }),
  ).instance("enabledFor honors the global setting", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      expect(yield* svc.enabledFor("github")).toBe(true)
    }),
  )

  harness(
    withConfig({}, "off"),
    catalog({ github_create_issue: tool("github", "create_issue", "x") }),
  ).instance("enabledFor defaults to off", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      expect(yield* svc.enabledFor("github")).toBe(false)
    }),
  )

  harness(
    withConfig({ github: { type: "local", command: ["x"], tool_search: "off" } }, "always"),
    catalog({ github_create_issue: tool("github", "create_issue", "x") }),
  ).instance("per-server tool_search overrides the global setting", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      expect(yield* svc.enabledFor("github")).toBe(false)
    }),
  )

  harness(
    withConfig({ github: { enabled: true } }, "always"),
    catalog({ github_create_issue: tool("github", "create_issue", "x") }),
  ).instance("enabled-only shorthand entry falls through to the global setting", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      expect(yield* svc.enabledFor("github")).toBe(true)
    }),
  )

  harness(
    withConfig(
      {},
      "auto",
    ),
    catalog(
      Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`srv_op_${i}`, tool("srv", `op_${i}`, `operation ${i}`)]),
      ),
    ),
  ).instance("auto enables once the visible surface crosses the threshold", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      expect(yield* svc.enabledFor("srv")).toBe(true)
    }),
  )

  harness(
    withConfig({}, "auto"),
    catalog({ srv_only: tool("srv", "only", "the one tool") }),
  ).instance("auto stays off below the threshold", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      expect(yield* svc.enabledFor("srv")).toBe(false)
    }),
  )

  harness(
    withConfig({}, "always"),
    catalog({
      github_create_issue: tool("github", "create_issue", "Create a GitHub issue"),
      github_list_repos: tool("github", "list_repos", "List repositories for a user"),
      sentry_list_issues: tool("sentry", "list_issues", "List Sentry issues"),
    }),
  ).instance("search ranks by relevance and marks matches resolved", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      const matches = yield* svc.search({ sessionID: sid, query: "github issue", ruleset: [] })
      expect(matches.map((m) => m.id)).toContain("github_create_issue")
      expect(matches[0].id).toBe("github_create_issue")
      const resolved = yield* svc.resolved(sid)
      for (const m of matches) expect(resolved.has(m.id)).toBe(true)
    }),
  )

  harness(
    withConfig({}, "always"),
    catalog({
      github_create_issue: tool("github", "create_issue", "Create a GitHub issue"),
      github_secret: tool("github", "secret", "A hidden admin tool"),
    }),
  ).instance("search excludes permission-denied tools", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      const ruleset = [{ permission: "github_secret", pattern: "*", action: "deny" as const }]
      const matches = yield* svc.search({ sessionID: sid, query: "github", ruleset })
      expect(matches.map((m) => m.id)).not.toContain("github_secret")
      expect(matches.map((m) => m.id)).toContain("github_create_issue")
    }),
  )

  harness(
    withConfig({}, "always"),
    catalog({
      github_create_issue: tool("github", "create_issue", "Create a GitHub issue"),
      github_list_repos: tool("github", "list_repos", "List repositories for a user"),
    }),
  ).instance("a blank query returns no matches and marks nothing resolved", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      expect(yield* svc.search({ sessionID: sid, query: "", ruleset: [] })).toEqual([])
      expect(yield* svc.search({ sessionID: sid, query: "   ", ruleset: [] })).toEqual([])
      expect((yield* svc.resolved(sid)).size).toBe(0)
    }),
  )

  harness(
    withConfig({}, "always"),
    catalog({ github_create_issue: tool("github", "create_issue", "x") }),
  ).instance("resolved is session-scoped and cumulative", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const svc = yield* McpToolSearch.Service
      const other = SessionID.make("ses_other")
      yield* svc.markResolved(sid, ["github_create_issue"])
      expect((yield* svc.resolved(sid)).has("github_create_issue")).toBe(true)
      expect((yield* svc.resolved(other)).has("github_create_issue")).toBe(false)
      // idempotent: no duplicates on re-resolve
      const fresh = yield* svc.markResolved(sid, ["github_create_issue"])
      expect(fresh).toEqual([])
    }),
  )
})
