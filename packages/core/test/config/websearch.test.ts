import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigWebSearchPlugin } from "@opencode/core/config/plugin/websearch"
import { Mcp } from "@opencode/core/mcp/index"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { WebSearch } from "@opencode/core/websearch"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigWebSearch } from "@opencode/schema/config/websearch"
import { Effect } from "effect"
import { emptyMcp } from "../fixture/mcp"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

describe("ConfigWebSearchPlugin.Plugin", () => {
  it.live("reloads changed default selection", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* websearch.transform((editor) =>
        editor.add({ id: WebSearch.ID.make("test"), name: "Test", execute: () => Effect.succeed([]) }),
      )
      yield* ConfigWebSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins))

      expect((yield* websearch.default().pipe(Effect.flip))._tag).toBe("WebSearch.Disabled")

      yield* config.setEntries([configured(new ConfigWebSearch.Info({ provider: "random" }))])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        websearch.default().pipe(
          Effect.map((provider) => provider?.id === WebSearch.ID.make("test")),
          Effect.orElseSucceed(() => false),
        ),
      )
    }).pipe(Effect.provide(Config.testLayer([configured(false)]))),
  )
})

describe("ConfigWebSearchPlugin MCP provider", () => {
  it.live("routes web search through the configured MCP tool", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const plugins = yield* Plugin.Service
      const calls: { server: string; name: string; args?: Record<string, unknown> }[] = []
      yield* ConfigWebSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins)).pipe(
        Effect.provideService(
          Mcp.Service,
          Mcp.Service.of({
            ...emptyMcp,
            callTool: (input) =>
              Effect.sync(() => {
                calls.push({ server: String(input.server), name: input.name, args: input.args })
                return {
                  isError: false,
                  content: [{ type: "text" as const, text: "plain search output" }],
                  server: Mcp.ServerName.make(String(input.server)),
                  tool: input.name,
                }
              }),
          }),
        ),
      )

      expect(yield* websearch.default()).toEqual({
        id: WebSearch.ID.make("mcp:searxng/search"),
        name: "searxng/search",
      })
      const response = yield* websearch.query({ query: "opencode" })
      expect(calls).toEqual([{ server: "searxng", name: "search", args: { q: "opencode" } }])
      expect(response.providerID).toBe(WebSearch.ID.make("mcp:searxng/search"))
      expect(response.results).toEqual([
        { url: "mcp://searxng/search", title: "searxng results", content: "plain search output", time: {} },
      ])
    }).pipe(
      Effect.provide(
        Config.testLayer([
          configured(new ConfigWebSearch.McpInfo({ mcp: { server: "searxng", tool: "search", argument: "q" } })),
        ]),
      ),
    ),
  )
})

describe("ConfigWebSearchPlugin MCP discovery", () => {
  const tool = (name: string, inputSchema: Record<string, unknown>): Mcp.Tool =>
    ({ name, inputSchema, server: Mcp.ServerName.make("searxng") }) as Mcp.Tool

  it.live("offers connected MCP search tools without selecting them", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const plugins = yield* Plugin.Service
      yield* ConfigWebSearchPlugin.Plugin.effect(yield* PluginHost.make(plugins)).pipe(
        Effect.provideService(
          Mcp.Service,
          Mcp.Service.of({
            ...emptyMcp,
            tools: () =>
              Effect.succeed([
                tool("web_search", { type: "object", properties: { q: { type: "string" } }, required: ["q"] }),
                tool("fetch", { type: "object", properties: { url: { type: "string" } } }),
              ]),
          }),
        ),
      )

      expect(yield* websearch.providers()).toContainEqual({
        id: WebSearch.ID.make("mcp:searxng/web_search"),
        name: "searxng/web_search",
      })
      expect((yield* websearch.providers()).map((provider) => provider.id)).not.toContain(
        WebSearch.ID.make("mcp:searxng/fetch"),
      )
      expect(yield* websearch.default()).toBeUndefined()
    }).pipe(Effect.provide(Config.testLayer([]))),
  )

  it.effect("accepts tools callable with only a query string", () =>
    Effect.sync(() => {
      expect(
        ConfigWebSearchPlugin.searchTool(
          tool("search", { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } }),
        ),
      ).toEqual([{ server: "searxng", tool: "search", argument: "query" }])
      expect(
        ConfigWebSearchPlugin.searchTool(
          tool("search_issues", {
            type: "object",
            properties: { query: { type: "string" }, owner: { type: "string" } },
            required: ["query", "owner"],
          }),
        ),
      ).toEqual([])
      expect(
        ConfigWebSearchPlugin.searchTool(tool("lookup", { type: "object", properties: { query: { type: "string" } } })),
      ).toEqual([])
    }),
  )
})

describe("ConfigWebSearchPlugin.toResults", () => {
  const result = (input: Partial<Mcp.ToolResult>): Mcp.ToolResult => ({
    isError: false,
    content: [],
    server: Mcp.ServerName.make("search"),
    tool: "web",
    ...input,
  })

  it.effect("reads structured result lists", () =>
    Effect.sync(() => {
      expect(
        ConfigWebSearchPlugin.toResults(
          result({ structured: { results: [{ url: "https://a.dev", title: "A", snippet: "about a" }] } }),
        ),
      ).toEqual([{ url: "https://a.dev", title: "A", content: "about a", time: {} }])
    }),
  )

  it.effect("reads JSON text result lists", () =>
    Effect.sync(() => {
      expect(
        ConfigWebSearchPlugin.toResults(
          result({ content: [{ type: "text", text: JSON.stringify([{ url: "https://b.dev", description: "b" }]) }] }),
        ),
      ).toEqual([{ url: "https://b.dev", content: "b", time: {} }])
    }),
  )

  it.effect("returns no results for empty output", () =>
    Effect.sync(() => {
      expect(ConfigWebSearchPlugin.toResults(result({}))).toEqual([])
    }),
  )
})

function configured(websearch: ConfigWebSearch.Selection): Document {
  return new Document({ type: "document", info: new Info({ websearch }) })
}

const waitUntil = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (yield* condition) return
    yield* Effect.sleep("10 millis")
  }
  yield* Effect.die(new Error("Timed out waiting for websearch config reload"))
})
