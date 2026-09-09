import { beforeEach, describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { WebSearch } from "@opencode/core/websearch"
import { WebSearchBrave } from "@opencode/core/plugin/websearch/brave"
import { WebSearchExa } from "@opencode/core/plugin/websearch/exa"
import { WebSearchFirecrawl } from "@opencode/core/plugin/websearch/firecrawl"
import { WebSearchParallel } from "@opencode/core/plugin/websearch/parallel"
import { WebSearchTavily } from "@opencode/core/plugin/websearch/tavily"
import { eventHost, host, integrationHost, webSearchHost } from "./host"
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
    { plugin: WebSearchBrave.Plugin, credential: Integration.ID.make("brave") },
    { plugin: WebSearchExa.Plugin, credential: undefined },
    { plugin: WebSearchParallel.Plugin, credential: undefined },
    { plugin: WebSearchFirecrawl.Plugin, credential: undefined },
    { plugin: WebSearchTavily.Plugin, credential: undefined },
  ].forEach(({ plugin, credential }) => {
    it.effect(`releases rate-limited HTTP requests for ${plugin.id} before caching their errors`, () =>
      Effect.gen(function* () {
        resetWebSearchFixture("Rate limited", 429)
        const credentials = yield* Credential.Service
        const integrations = yield* Integration.Service
        const websearch = yield* WebSearch.Service
        if (credential)
          yield* credentials.create({
            integrationID: credential,
            value: Credential.Key.make({ type: "key", key: "rate-limited" }),
          })
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

  it.effect("registers Brave Search and maps web results", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Effect",
                url: "https://effect.website",
                description: "Effect documentation",
                extra_snippets: ["  Typed errors  ", ""],
                age: "2 hours ago",
                page_age: "2026-09-09T13:55:04",
              },
              { url: "https://effect.website/docs", age: "2 weeks ago" },
            ],
          },
        }),
      )
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("brave"),
        value: Credential.Key.make({ type: "key", key: "brave-secret" }),
      })
      yield* WebSearchBrave.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      expect(yield* integrations.get(Integration.ID.make("brave"))).toMatchObject({
        id: "brave",
        name: "Brave Search",
        methods: [{ type: "key" }, { type: "env", names: ["BRAVE_API_KEY"] }],
      })

      expect(yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("brave") })).toEqual(
        new WebSearch.Response({
          providerID: WebSearch.ID.make("brave"),
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              content: "Effect documentation\n\nTyped errors",
              // `page_age` is a zoneless UTC timestamp; the human readable `age` above is ignored.
              time: { published: Date.parse("2026-09-09T13:55:04Z") },
            },
            { url: "https://effect.website/docs", time: {} },
          ],
        }),
      )

      const requested = new URL(requests[0].url)
      expect(`${requested.origin}${requested.pathname}`).toBe(WebSearchBrave.endpoint)
      expect(requested.searchParams.get("q")).toBe("effect typescript")
      expect(requested.searchParams.get("count")).toBe("8")
      expect(requested.searchParams.get("text_decorations")).toBe("false")
      expect(requested.searchParams.get("extra_snippets")).toBe("true")
      expect(requests[0]).toMatchObject({ headers: { "x-subscription-token": "brave-secret" } })
      expect(requests[0]?.body).toBeUndefined()
    }),
  )

  it.effect("registers Brave Search only once a key is configured", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      // Resolves once the plugin has reacted to the credential event, so the assertion cannot race it.
      const reloaded = yield* Deferred.make<void>()
      const websearchHost = webSearchHost(websearch)
      yield* WebSearchBrave.Plugin.effect(
        host({
          integration: integrationHost(integrations),
          event: eventHost(bus),
          websearch: {
            ...websearchHost,
            reload: () => websearchHost.reload().pipe(Effect.andThen(Deferred.succeed(reloaded, undefined))),
          },
        }),
      )
      expect(yield* websearch.providers()).not.toContainEqual({
        id: WebSearch.ID.make("brave"),
        name: "Brave Search",
      })

      yield* integrations.connection.key({ integrationID: Integration.ID.make("brave"), key: "brave-secret" })
      yield* Deferred.await(reloaded)

      expect(yield* websearch.providers()).toContainEqual({
        id: WebSearch.ID.make("brave"),
        name: "Brave Search",
      })
    }),
  )

  it.effect("keeps an unconfigured Brave Search out of random selection", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({ results: [{ url: "https://effect.website", title: "Effect", content: "docs" }] }),
      )
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      const context = host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) })
      yield* WebSearchBrave.Plugin.effect(context)
      yield* WebSearchTavily.Plugin.effect(context)
      yield* websearch.select("random")

      // Brave cannot serve a query without a key, and the service only fails over on a 429, so an
      // unconfigured Brave in the rotation would wedge the session instead of falling back.
      for (let attempt = 0; attempt < 10; attempt++) {
        expect(yield* websearch.query({ query: "effect typescript" })).toMatchObject({
          providerID: WebSearch.ID.make("tavily"),
        })
      }
    }),
  )

  it.effect("fails Brave Search when its key is removed after registration", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      const credential = yield* credentials.create({
        integrationID: Integration.ID.make("brave"),
        value: Credential.Key.make({ type: "key", key: "brave-secret" }),
      })
      // No event host, so the registry keeps Brave while the credential disappears underneath it.
      yield* WebSearchBrave.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )
      yield* credentials.remove(credential.id)

      const error = yield* websearch
        .query({ query: "effect typescript", providerID: WebSearch.ID.make("brave") })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(WebSearch.RequestError)
      expect(error).toHaveProperty("cause.message", expect.stringContaining("requires an API key"))
      expect(requests).toHaveLength(0)
    }),
  )

  it.effect("parses Brave page_age as UTC regardless of the local timezone", () =>
    Effect.gen(function* () {
      resetWebSearchFixture(
        JSON.stringify({ web: { results: [{ url: "https://effect.website", page_age: "2026-09-09T13:55:04" }] } }),
      )
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("brave"),
        value: Credential.Key.make({ type: "key", key: "brave-secret" }),
      })
      yield* WebSearchBrave.Plugin.effect(
        host({ integration: integrationHost(integrations), websearch: webSearchHost(websearch) }),
      )

      // bun runs tests in UTC, so a zoneless parse is only distinguishable from a UTC one under another zone.
      const previous = process.env.TZ
      process.env.TZ = "America/Chicago"
      const response = yield* Effect.ensuring(
        websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("brave") }),
        Effect.sync(() => {
          if (previous === undefined) delete process.env.TZ
          else process.env.TZ = previous
        }),
      )
      expect(response.results[0]?.time.published).toBe(Date.parse("2026-09-09T13:55:04Z"))
    }),
  )
})
