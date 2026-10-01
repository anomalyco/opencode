export * as WebSearchFirecrawl from "./firecrawl.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Option, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { App } from "../../app.js"
import { collectBoundedResponseBody } from "../../tool/http-body.js"
import { WebSearchMcp } from "./mcp.js"

export const endpoint = "https://mcp.firecrawl.dev/v2/mcp"
// The developer index is on the REST API because the MCP tool for it is hidden from keyless sessions.
export const developerEndpoint = "https://api.firecrawl.dev/v2/search/developer"

const McpInput = Schema.Struct({
  query: Schema.String,
  limit: Schema.Number.pipe(Schema.optional),
})

const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
})

const SearchResponse = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Boolean,
    data: Schema.Struct({
      web: Schema.Array(
        Schema.Struct({
          url: Schema.String,
          title: Schema.NullOr(Schema.String).pipe(Schema.optional),
          description: Schema.NullOr(Schema.String).pipe(Schema.optional),
        }),
      ),
    }),
  }),
)
const decodeSearchResponse = Schema.decodeUnknownOption(SearchResponse)

const DeveloperRequest = Schema.Struct({
  query: Schema.String,
  k: Schema.Number,
  passages: Schema.Number,
})

const DeveloperResponse = Schema.fromJsonString(
  Schema.Struct({
    results: Schema.Array(
      Schema.Struct({
        url: Schema.String,
        title: Schema.NullOr(Schema.String).pipe(Schema.optional),
        passages: Schema.Array(Schema.Struct({ text: Schema.String })).pipe(Schema.optional),
      }),
    ),
  }),
)
const decodeDeveloperResponse = Schema.decodeUnknownEffect(DeveloperResponse)

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.firecrawl",
  effect: Effect.fn("WebSearchFirecrawl.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("firecrawl", (integration) => (integration.name = "Firecrawl"))
      editor.method.update({
        integrationID: "firecrawl",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "firecrawl",
        method: { type: "env", names: ["FIRECRAWL_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "firecrawl",
        name: "Firecrawl",
        categories: ["developer"],
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("firecrawl")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const headers = {
              "User-Agent": App.useragent(ctx.app),
              ...(credential?.type === "key" ? { Authorization: `Bearer ${credential.key}` } : {}),
            }
            if (input.category === "developer") return yield* developerSearch(http, input.query, headers)
            const result = yield* WebSearchMcp.call(
              http,
              endpoint,
              "firecrawl_search",
              { input: McpInput, output: McpOutput },
              { query: input.query, limit: 8 },
              headers,
            )
            const content = result?.content.find((item) => item.text)
            const response = content ? Option.getOrUndefined(decodeSearchResponse(content.text)) : undefined
            return (
              response?.data.web.map((item) => ({
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(item.description ? { content: item.description } : {}),
                time: {},
              })) ?? []
            )
          }),
      })
    })
  }),
})

const developerSearch = (http: HttpClient.HttpClient, query: string, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(developerEndpoint).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(DeveloperRequest)({ query, k: 8, passages: 3 }),
    )
    const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http)).execute(request)
    const body = yield* collectBoundedResponseBody(
      response,
      WebSearchMcp.MAX_RESPONSE_BYTES,
      () => new Error(`Firecrawl developer search response exceeded ${WebSearchMcp.MAX_RESPONSE_BYTES} bytes`),
    )
    const decoded = yield* decodeDeveloperResponse(body.toString("utf8"))
    return decoded.results.map((item) => ({
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.passages?.length ? { content: item.passages.map((passage) => passage.text).join("\n\n") } : {}),
      time: {},
    }))
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: Duration.seconds(25),
      orElse: () => Effect.fail(new Error("Firecrawl developer search request timed out")),
    }),
  )
