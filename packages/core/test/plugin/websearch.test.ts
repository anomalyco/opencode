import { beforeEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Integration } from "@opencode-ai/core/integration"
import { WebSearch } from "@opencode-ai/core/websearch"
import { WebSearchExa } from "@opencode-ai/core/plugin/websearch/exa"
import { WebSearchParallel } from "@opencode-ai/core/plugin/websearch/parallel"
import { host, integrationHost, webSearchHost } from "./host"
import { requests, resetWebSearchFixture, webSearchIntegrationTest } from "./websearch-fixture"

beforeEach(() => {
  resetWebSearchFixture(
    `event: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "search results", _meta: { searchTime: 123 } }] },
    })}\n\n`,
  )
})

const it = webSearchIntegrationTest

describe("built-in web search providers", () => {
  it.effect("registers a provider without an integration", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const websearch = yield* WebSearch.Service
      const registration = yield* webSearchHost(websearch).register({
        id: "test-websearch",
        name: "Test Web Search",
        execute: (input) => Effect.succeed({ text: input.query }),
      })

      expect(yield* integrations.get(Integration.ID.make("test-websearch"))).toBeUndefined()
      expect(yield* websearch.list()).toContainEqual({
        id: WebSearch.ID.make("test-websearch"),
        name: "Test Web Search",
      })
      yield* registration.dispose
      expect(yield* websearch.list()).not.toContainEqual({
        id: WebSearch.ID.make("test-websearch"),
        name: "Test Web Search",
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
      expect(
        yield* websearch.query({ query: "effect typescript", providerID: WebSearch.ID.make("exa") }),
      ).toEqual(
        new WebSearch.Result({
          providerID: WebSearch.ID.make("exa"),
          text: "search results",
          metadata: { searchTime: 123 },
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
      yield* integrations.connection.key({ integrationID: Integration.ID.make("parallel"), key: "parallel-secret" })

      const output = yield* websearch.query({
        query: "effect layers",
        providerID: WebSearch.ID.make("parallel"),
        sessionID: "ses_parallel",
      })
      expect(output).toEqual(
        new WebSearch.Result({
          providerID: WebSearch.ID.make("parallel"),
          text: "search results",
          metadata: {
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
              session_id: "ses_parallel",
            },
          },
        },
      })
      expect(JSON.stringify(output)).not.toContain("parallel-secret")
    }),
  )
})
