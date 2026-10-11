import { beforeEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Integration } from "@opencode/core/integration"
import { WebSearch } from "@opencode/core/websearch"
import { WebSearchExa } from "@opencode/core/plugin/websearch/exa"
import { WebSearchFirecrawl } from "@opencode/core/plugin/websearch/firecrawl"
import { WebSearchParallel } from "@opencode/core/plugin/websearch/parallel"
import { WebSearchTavily } from "@opencode/core/plugin/websearch/tavily"
import { WebSearchTinyFish } from "@opencode/core/plugin/websearch/tinyfish"
import { host, integrationHost, webSearchHost } from "./host"
import { requests, signals, resetWebSearchFixture, webSearchIntegrationTest } from "./websearch-fixture"

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

  it.effect("uses a configured Exa REST endpoint and key", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              publishedDate: "2026-07-25T00:00:00.000Z",
              text: "Effect documentation",
            },
          ],
        }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      const context = host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) })
      yield* WebSearchExa.Plugin.effect(context)
      yield* context.websearch.transform((editor) =>
        editor.settings.set("exa", {
          endpoint: "https://search.example.com/v1/exa/search",
          apiKey: "proxy-secret",
        }),
      )

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
          url: "https://search.example.com/v1/exa/search",
          headers: expect.objectContaining({ "x-api-key": "proxy-secret" }),
          body: {
            query: "effect typescript",
            numResults: 8,
            contents: { text: true },
          },
        },
      ])
    }),
  )

  it.effect("does not send the stored credential to a configured endpoint", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(JSON.stringify({ results: [{ url: "https://effect.website", title: "Effect" }] }))
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      const context = host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) })
      yield* WebSearchExa.Plugin.effect(context)
      yield* integrations.connection.key({ integrationID: Integration.ID.make("exa"), key: "exa secret" })
      yield* context.websearch.transform((editor) =>
        editor.settings.set("exa", { endpoint: "https://search.example.com/v1/exa/search" }),
      )

      yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("exa") })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe("https://search.example.com/v1/exa/search")
      expect(requests[0]?.headers["x-api-key"]).toBeUndefined()
      expect(requests[0]?.body).toEqual({ query: "effect typescript", numResults: 8, contents: { text: true } })
    }),
  )

  const endpointCases = [
    { plugin: WebSearchParallel.Plugin, id: "parallel", expected: { authorization: "Bearer proxy-key" } },
    { plugin: WebSearchFirecrawl.Plugin, id: "firecrawl", expected: { authorization: "Bearer proxy-key" } },
    { plugin: WebSearchTinyFish.Plugin, id: "tinyfish", expected: { "x-api-key": "proxy-key" } },
    { plugin: WebSearchTavily.Plugin, id: "tavily", expected: { authorization: "Bearer proxy-key" } },
  ] as const

  endpointCases.forEach((item) => {
    it.effect(`${item.id} uses a configured endpoint and key`, () =>
      Effect.gen(function* () {
        resetWebSearchFixture(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [], results: [] } }))
        const integrations = yield* Integration.Service
        const websearch = yield* WebSearch.Service
        const context = host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) })
        yield* item.plugin.effect(context)
        yield* integrations.connection.key({ integrationID: Integration.ID.make(item.id), key: "stored-secret" })
        yield* context.websearch.transform((editor) =>
          editor.settings.set(item.id, { endpoint: "https://proxy.example.com/search", apiKey: "proxy-key" }),
        )

        yield* websearch.query({ query: "custom", providerID: WebSearch.ID.make(item.id) }).pipe(Effect.ignore)
        expect(requests[0]?.url).toBe("https://proxy.example.com/search")
        expect(requests[0]?.headers).toMatchObject(item.expected)
        expect(Object.values(requests[0]?.headers ?? {})).not.toContain("stored-secret")
        expect(Object.values(requests[0]?.headers ?? {})).not.toContain("Bearer stored-secret")
      }),
    )
  })

  it.effect("does not forward a stored credential to a configured endpoint", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }))
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      const context = host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) })
      yield* WebSearchParallel.Plugin.effect(context)
      yield* integrations.connection.key({ integrationID: Integration.ID.make("parallel"), key: "stored-secret" })
      yield* context.websearch.transform((editor) =>
        editor.settings.set("parallel", { endpoint: "https://proxy.example.com/search" }),
      )

      yield* websearch.query({ query: "custom", providerID: WebSearch.ID.make("parallel") }).pipe(Effect.ignore)
      expect(requests[0]?.url).toBe("https://proxy.example.com/search")
      expect(Object.values(requests[0]?.headers ?? {})).not.toContain("Bearer stored-secret")
    }),
  )

  it.effect("falls back to the stored credential when the configured key is empty", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      const context = host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) })
      yield* WebSearchExa.Plugin.effect(context)
      yield* integrations.connection.key({ integrationID: Integration.ID.make("exa"), key: "exa secret" })
      yield* context.websearch.transform((editor) => editor.settings.set("exa", { apiKey: "" }))

      yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("exa") })
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
      yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("tinyfish") })
      expect(requests[1]).toMatchObject({
        headers: { "x-api-key": "tinyfish-secret" },
      })
      expect(requests[1]?.headers["x-tinyfish-access-mode"]).toBeUndefined()
    }),
  )
})
