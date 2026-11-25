import { beforeEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Integration } from "@opencode/core/integration"
import { WebSearch } from "@opencode/core/websearch"
import { WebSearchExa } from "@opencode/core/plugin/websearch/exa"
import { WebSearchFirecrawl } from "@opencode/core/plugin/websearch/firecrawl"
import { WebSearchParallel } from "@opencode/core/plugin/websearch/parallel"
import { WebSearchTavily } from "@opencode/core/plugin/websearch/tavily"
import { WebSearchTinyFish } from "@opencode/core/plugin/websearch/tinyfish"
import { WebSearchYouCom } from "@opencode/core/plugin/websearch/youcom"
import { withEnv } from "../fixture/env"
import { host, integrationHost, webSearchHost } from "./host"
import {
  requests,
  signals,
  resetWebSearchFixture,
  setResponseHeaders,
  webSearchIntegrationTest,
} from "./websearch-fixture"

beforeEach(() => {
  resetWebSearchFixture(
    `event: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: "Title: Effect\nURL: https://effect.website\nPublished: 2026-07-25T00:00:00.000Z\nAuthor: N/A\nHighlights:\nEffect documentation",
            _meta: { searchTime: 123 },
          },
        ],
      },
    })}\n\n`,
  )
})

const it = webSearchIntegrationTest

describe("built-in web search providers", () => {
  ;[
    WebSearchExa.Plugin,
    WebSearchParallel.Plugin,
    WebSearchFirecrawl.Plugin,
    WebSearchTavily.Plugin,
    WebSearchTinyFish.Plugin,
    WebSearchYouCom.Plugin,
  ].forEach((plugin) => {
    it.effect(`releases rate-limited HTTP requests for ${plugin.id} before caching their errors`, () =>
      Effect.gen(function* () {
        resetWebSearchFixture("Rate limited", 429)
        const integrations = yield* Integration.Service
        const websearch = yield* WebSearch.Service
        yield* plugin.effect(host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }))
        yield* websearch.select("random")
        expect(yield* websearch.query({ query: "limited" }).pipe(Effect.flip)).toBeInstanceOf(WebSearch.RequestError)
        expect(signals).toHaveLength(1)
        expect(signals[0]?.aborted).toBe(true)
      }),
    )
  })

  it.effect("registers a provider without an integration", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      const registration = yield* webSearchHost(websearch).transform((editor) => {
        editor.add({
          id: "test-websearch",
          name: "Test Web Search",
          execute: (input) => Effect.succeed([{ url: "https://example.com", content: input.query, time: {} }]),
        })
      })

      expect(yield* integrations.get(Integration.ID.make("test-websearch"))).toBeUndefined()
      expect(yield* websearch.providers()).toContainEqual({
        id: WebSearch.ID.make("test-websearch"),
        name: "Test Web Search",
      })
      yield* registration.dispose
      expect(yield* websearch.providers()).not.toContainEqual({
        id: WebSearch.ID.make("test-websearch"),
        name: "Test Web Search",
      })
    }),
  )

  it.effect("registers Firecrawl with the standard key method", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchFirecrawl.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect(yield* integrations.get(Integration.ID.make("firecrawl"))).toMatchObject({
        id: "firecrawl",
        name: "Firecrawl",
        methods: [{ type: "key" }, { type: "env", names: ["FIRECRAWL_API_KEY"] }],
      })
    }),
  )

  it.effect("registers Exa with its MCP schema", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchExa.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      const info = yield* integrations.get(Integration.ID.make("exa"))
      expect(info).toMatchObject({
        id: "exa",
        name: "Exa",
        methods: [{ type: "key" }, { type: "env", names: ["EXA_API_KEY"] }],
      })
      yield* integrations.connection.key({ integrationID: Integration.ID.make("exa"), key: "exa secret" })
      expect(yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("exa") })).toEqual(
        new WebSearch.Response({
          providerID: WebSearch.ID.make("exa"),
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              content: "Effect documentation",
              time: { published: Date.parse("2026-07-25T00:00:00.000Z") },
            },
          ],
        }),
      )
      expect(requests).toEqual([
        {
          url: `${WebSearchExa.endpoint}?exaApiKey=exa+secret`,
          headers: expect.any(Object),
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "web_search_exa",
              arguments: { query: "effect typescript", numResults: 8 },
            },
          },
        },
      ])
    }),
  )

  it.effect("registers Parallel and keeps its credential in the authorization header", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: "search results" }],
            structuredContent: {
              search_id: "search_1",
              results: [
                {
                  url: "https://effect.website",
                  title: "Effect",
                  publish_date: null,
                  excerpts: ["Effect documentation"],
                },
              ],
              warnings: null,
              usage: [{ name: "sku_search", count: 1 }],
              session_id: "ses_parallel",
            },
          },
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchParallel.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )
      expect(yield* integrations.get(Integration.ID.make("parallel"))).toMatchObject({
        methods: [{ type: "key" }, { type: "env", names: ["PARALLEL_API_KEY"] }],
      })
      yield* integrations.connection.key({
        integrationID: Integration.ID.make("parallel"),
        key: "parallel-secret",
      })

      const output = yield* websearch.query({
        query: "effect layers",
        providerID: WebSearch.ID.make("parallel"),
      })
      expect(output).toEqual(
        new WebSearch.Response({
          providerID: WebSearch.ID.make("parallel"),
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              content: "Effect documentation",
              time: {},
            },
          ],
        }),
      )
      expect(requests[0]).toMatchObject({
        url: WebSearchParallel.endpoint,
        headers: { authorization: "Bearer parallel-secret" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "web_search",
            arguments: {
              objective: "effect layers",
              search_queries: ["effect layers"],
            },
          },
        },
      })
      expect(JSON.stringify(output)).not.toContain("parallel-secret")
    }),
  )

  it.effect("registers Tavily with keyless and keyed Search API access", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          query: "effect typescript",
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              content: "Effect documentation",
              score: 0.99,
            },
          ],
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchTavily.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect(yield* integrations.get(Integration.ID.make("tavily"))).toMatchObject({
        id: "tavily",
        name: "Tavily",
        methods: [{ type: "key" }, { type: "env", names: ["TAVILY_API_KEY"] }],
      })
      const query = {
        query: "effect typescript",
        providerID: WebSearch.ID.make("tavily"),
      }
      expect(yield* websearch.query(query)).toEqual(
        new WebSearch.Response({
          providerID: WebSearch.ID.make("tavily"),
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              content: "Effect documentation",
              time: {},
            },
          ],
        }),
      )
      expect(requests[0]).toMatchObject({
        url: WebSearchTavily.endpoint,
        headers: { "x-client-name": "opencode2", "x-tavily-access-mode": "keyless" },
        body: {
          query: "effect typescript",
          search_depth: "basic",
          chunks_per_source: 3,
          max_results: 8,
        },
      })
      expect(requests[0]?.headers.authorization).toBeUndefined()

      yield* integrations.connection.key({
        integrationID: Integration.ID.make("tavily"),
        key: "tavily-secret",
      })
      yield* websearch.query(query)
      expect(requests[1]).toMatchObject({
        headers: { authorization: "Bearer tavily-secret", "x-client-name": "opencode2" },
      })
      expect(requests[1]?.headers["x-tavily-access-mode"]).toBeUndefined()
    }),
  )

  it.effect("registers TinyFish with keyless and keyed MCP search access", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  query: "effect typescript",
                  results: [
                    {
                      position: 1,
                      site_name: "effect.website",
                      snippet: "Effect documentation",
                      title: "Effect",
                      url: "https://effect.website",
                    },
                  ],
                  total_results: 1,
                  page: 0,
                }),
              },
            ],
          },
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchTinyFish.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect(yield* integrations.get(Integration.ID.make("tinyfish"))).toMatchObject({
        id: "tinyfish",
        name: "TinyFish",
        methods: [{ type: "key" }, { type: "env", names: ["TINYFISH_API_KEY"] }],
      })
      expect(yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("tinyfish") })).toEqual(
        new WebSearch.Response({
          providerID: WebSearch.ID.make("tinyfish"),
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              content: "Effect documentation",
              time: {},
            },
          ],
        }),
      )
      expect(requests[0]).toMatchObject({
        url: WebSearchTinyFish.endpoint,
        headers: { "x-tinyfish-access-mode": "keyless" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "search",
            arguments: { query: "effect typescript" },
          },
        },
      })
      expect(requests[0]?.headers.authorization).toBeUndefined()

      yield* integrations.connection.key({
        integrationID: Integration.ID.make("tinyfish"),
        key: "tinyfish-secret",
      })
      setResponseHeaders({ "mcp-session-id": "ses_tinyfish" })
      yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("tinyfish") })
      expect(requests[1]?.body).toMatchObject({ method: "initialize" })
      expect(requests[2]?.body).toMatchObject({ method: "notifications/initialized" })
      expect(requests[3]).toMatchObject({
        headers: { "x-api-key": "tinyfish-secret", "mcp-session-id": "ses_tinyfish" },
        body: { method: "tools/call" },
      })
      expect(requests[3]?.headers["x-tinyfish-access-mode"]).toBeUndefined()
    }),
  )

  it.effect("registers You.com with keyless MCP search access", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: "{}" }],
            structuredContent: {
              results: {
                web: [
                  {
                    url: "https://effect.website",
                    title: "Effect",
                    description: "Effect description",
                    page_age: "2026-07-25T00:00:00",
                    contents: { highlights: ["Effect documentation", "Effect layers"] },
                  },
                ],
              },
              metadata: { query: "effect typescript" },
            },
          },
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchYouCom.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect(yield* integrations.get(Integration.ID.make("youcom"))).toMatchObject({
        id: "youcom",
        name: "You.com",
        methods: [{ type: "key" }, { type: "env", names: ["YDC_API_KEY"] }],
      })
      // page_age has no zone designator but is UTC, so a non-UTC zone must not shift it.
      expect(
        yield* withEnv({ TZ: "America/Chicago" }, () =>
          websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("youcom") }),
        ),
      ).toEqual(
        new WebSearch.Response({
          providerID: WebSearch.ID.make("youcom"),
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              content: "Effect documentation\n\nEffect layers",
              time: { published: Date.UTC(2026, 6, 25) },
            },
          ],
        }),
      )
      expect(requests[0]).toMatchObject({
        url: WebSearchYouCom.keylessEndpoint,
        headers: { "user-agent": expect.stringContaining("opencode/") },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "you-search", arguments: { query: "effect typescript", count: 8 } },
        },
      })
      expect(requests[0]?.headers.authorization).toBeUndefined()
    }),
  )

  it.effect("sends a connected You.com key to the default MCP endpoint", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: "{}" }],
            structuredContent: { results: { web: [{ url: "https://effect.website" }] }, metadata: {} },
          },
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchYouCom.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )
      yield* integrations.connection.key({ integrationID: Integration.ID.make("youcom"), key: "youcom-secret" })

      const output = yield* websearch.query({ query: "effect", providerID: WebSearch.ID.make("youcom") })
      expect(output.results).toEqual([{ url: "https://effect.website", time: {} }])
      expect(requests[0]).toMatchObject({
        url: WebSearchYouCom.endpoint,
        headers: { authorization: "Bearer youcom-secret" },
      })
      expect(JSON.stringify(output)).not.toContain("youcom-secret")
    }),
  )

  it.effect("maps You.com results without highlights, titles, or valid dates", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: "{}" }],
            structuredContent: {
              results: {
                web: [
                  { url: "https://a.test", description: "A description", contents: { highlights: [] } },
                  { url: "https://b.test", title: "", page_age: "not a date" },
                  { url: "https://c.test", page_age: "2026-07-25T02:00:00+02:00" },
                ],
              },
              metadata: {},
            },
          },
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchYouCom.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect((yield* websearch.query({ query: "q", providerID: WebSearch.ID.make("youcom") })).results).toEqual([
        { url: "https://a.test", content: "A description", time: {} },
        { url: "https://b.test", time: {} },
        { url: "https://c.test", time: { published: Date.UTC(2026, 6, 25) } },
      ])
    }),
  )

  it.effect("returns no You.com results when the search finds nothing", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: "No results found." }],
            structuredContent: { results: {}, metadata: {} },
          },
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchYouCom.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect((yield* websearch.query({ query: "q", providerID: WebSearch.ID.make("youcom") })).results).toEqual([])
    }),
  )

  it.effect("fails You.com searches that return an MCP tool error", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "Error: Rate limited" }], isError: true },
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchYouCom.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect(
        yield* websearch.query({ query: "q", providerID: WebSearch.ID.make("youcom") }).pipe(Effect.flip),
      ).toBeInstanceOf(WebSearch.RequestError)
    }),
  )
})
