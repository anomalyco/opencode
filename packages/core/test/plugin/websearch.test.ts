import { beforeEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Integration } from "@opencode/core/integration"
import { WebSearch } from "@opencode/core/websearch"
import { WebSearchExa } from "@opencode/core/plugin/websearch/exa"
import { WebSearchFirecrawl } from "@opencode/core/plugin/websearch/firecrawl"
import { WebSearchParallel } from "@opencode/core/plugin/websearch/parallel"
import { WebSearchResponse } from "@opencode/core/plugin/websearch/response"
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
const sseMessage = (message: object) =>
  `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, ...message })}\n\n`

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

  describe("responses larger than the size cap", () => {
    const huge = "x".repeat(2 * WebSearchResponse.MAX_BYTES)
    const mcpText = (text: string) => sseMessage({ result: { content: [{ type: "text", text }] } })
    const exaBlock = (url: string, title: string, content: string) =>
      `Title: ${title}\nURL: ${url}\nPublished: N/A\nAuthor: N/A\nHighlights:\n${content}`
    const parallelSearch = {
      search_id: "search_1",
      results: [
        { url: "https://effect.website", title: "Effect", publish_date: null, excerpts: ["Effect documentation"] },
        { url: "https://huge.example.com", title: "Huge", publish_date: null, excerpts: [huge] },
        { url: "https://after.example.com", title: "After", publish_date: null, excerpts: ["after"] },
      ],
      session_id: "ses_parallel",
    }
    ;[
      {
        plugin: WebSearchExa.Plugin,
        providerID: WebSearch.ID.make("exa"),
        body: mcpText(
          [
            exaBlock("https://effect.website", "Effect", "Effect documentation"),
            exaBlock("https://huge.example.com", "Huge", huge),
            exaBlock("https://after.example.com", "After", "after"),
          ].join("\n\n---\n\n"),
        ),
      },
      {
        plugin: WebSearchFirecrawl.Plugin,
        providerID: WebSearch.ID.make("firecrawl"),
        body: mcpText(
          JSON.stringify({
            success: true,
            data: {
              web: [
                { url: "https://effect.website", title: "Effect", description: "Effect documentation" },
                { url: "https://huge.example.com", title: "Huge", description: huge },
                { url: "https://after.example.com", title: "After", description: "after" },
              ],
            },
          }),
        ),
      },
      {
        plugin: WebSearchParallel.Plugin,
        providerID: WebSearch.ID.make("parallel"),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: JSON.stringify(parallelSearch) }],
            structuredContent: parallelSearch,
          },
        }),
      },
      {
        plugin: WebSearchTavily.Plugin,
        providerID: WebSearch.ID.make("tavily"),
        body: JSON.stringify({
          results: [
            { title: "Effect", url: "https://effect.website", content: "Effect documentation" },
            { title: "Huge", url: "https://huge.example.com", content: huge },
            { title: "After", url: "https://after.example.com", content: "after" },
          ],
        }),
      },
      {
        plugin: WebSearchTinyFish.Plugin,
        providerID: WebSearch.ID.make("tinyfish"),
        body: mcpText(
          JSON.stringify({
            results: [
              { title: "Effect", url: "https://effect.website", snippet: "Effect documentation" },
              { title: "Huge", url: "https://huge.example.com", snippet: huge },
              { title: "After", url: "https://after.example.com", snippet: "after" },
            ],
          }),
        ),
      },
    ].forEach((provider) => {
      it.effect(`keeps the complete results from ${provider.plugin.id}`, () =>
        Effect.gen(function* () {
          resetWebSearchFixture(provider.body)
          const integrations = yield* Integration.Service
          const websearch = yield* WebSearch.Service
          yield* provider.plugin.effect(
            host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
          )

          expect(yield* websearch.query({ query: "effect", providerID: provider.providerID })).toEqual(
            new WebSearch.Response({
              providerID: provider.providerID,
              results: [{ url: "https://effect.website", title: "Effect", content: "Effect documentation", time: {} }],
            }),
          )
        }),
      )
    })
  })

  it.effect("reports MCP tool errors instead of returning no results", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchFirecrawl.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )
      const search = websearch.query({ query: "effect", providerID: WebSearch.ID.make("firecrawl") }).pipe(Effect.flip)

      resetWebSearchFixture(
        sseMessage({ result: { isError: true, content: [{ type: "text", text: "Rate limit exceeded" }] } }),
      )
      expect((yield* search).message).toBe("Rate limit exceeded")
      resetWebSearchFixture(sseMessage({ error: { code: -32602, message: "Invalid arguments" } }))
      expect((yield* search).message).toBe("Invalid arguments")
    }),
  )

  it.effect("reports the provider's explanation for HTTP failures", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchTinyFish.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )
      yield* WebSearchTavily.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )
      const quota =
        "Free daily Search quota used (50/50). Sign up for continued access: https://agent.tinyfish.ai/sign-up"

      resetWebSearchFixture(JSON.stringify({ jsonrpc: "2.0", error: { code: -31001, message: quota }, id: 1 }), 401)
      const tinyfish = yield* websearch
        .query({ query: "effect", providerID: WebSearch.ID.make("tinyfish") })
        .pipe(Effect.flip)
      expect(tinyfish.message).toBe(`HTTP 401: ${quota}`)

      resetWebSearchFixture(JSON.stringify({ detail: { error: "Unauthorized: missing or invalid API key." } }), 401)
      const tavily = yield* websearch
        .query({ query: "effect", providerID: WebSearch.ID.make("tavily") })
        .pipe(Effect.flip)
      expect(tavily.message).toBe("HTTP 401: Unauthorized: missing or invalid API key.")
    }),
  )

  it.effect("limits oversized Firecrawl results instead of failing the search", () =>
    Effect.gen(function* () {
      const thread = "comment ".repeat(64 * 1024)
      resetWebSearchFixture(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  data: {
                    web: [
                      { url: "https://news.ycombinator.com/item?id=1", title: "Thread", description: thread },
                      { url: "https://effect.website", title: "Effect", description: "Effect documentation" },
                    ],
                  },
                }),
              },
            ],
          },
        })}\n\n`,
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* WebSearchFirecrawl.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect(yield* websearch.query({ query: "opencode", providerID: WebSearch.ID.make("firecrawl") })).toEqual(
        new WebSearch.Response({
          providerID: WebSearch.ID.make("firecrawl"),
          results: [
            {
              url: "https://news.ycombinator.com/item?id=1",
              title: "Thread",
              content: `${thread.slice(0, WebSearch.MAX_RESULT_CONTENT_LENGTH)}\n[truncated]`,
              time: {},
            },
            { url: "https://effect.website", title: "Effect", content: "Effect documentation", time: {} },
          ],
        }),
      )
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
      yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("tinyfish") })
      expect(requests[1]).toMatchObject({
        headers: { "x-api-key": "tinyfish-secret" },
      })
      expect(requests[1]?.headers["x-tinyfish-access-mode"]).toBeUndefined()
    }),
  )
})
