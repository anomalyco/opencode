export * as WebSearchTinyFish from "./tinyfish.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Option, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { App } from "../../app.js"
import { collectBoundedResponseBody } from "../../tool/http-body.js"
import { WebSearchMcp } from "./mcp.js"

export const endpoint = "https://agent.tinyfish.ai/mcp"

const McpInput = Schema.Struct({
  query: Schema.String,
})

const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
})

const SearchResponse = Schema.fromJsonString(
  Schema.Struct({
    results: Schema.Array(
      Schema.Struct({
        url: Schema.String,
        title: Schema.String,
        snippet: Schema.String,
      }),
    ),
  }),
)
const decodeSearchResponse = Schema.decodeUnknownOption(SearchResponse)

const InitializeRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Literal(1),
  method: Schema.Literal("initialize"),
  params: Schema.Struct({
    protocolVersion: Schema.String,
    capabilities: Schema.Struct({}),
    clientInfo: Schema.Struct({ name: Schema.String, version: Schema.String }),
  }),
})

const InitializedNotification = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.Literal("notifications/initialized"),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.tinyfish",
  effect: Effect.fn("WebSearchTinyFish.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("tinyfish", (integration) => (integration.name = "TinyFish"))
      editor.method.update({
        integrationID: "tinyfish",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "tinyfish",
        method: { type: "env", names: ["TINYFISH_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "tinyfish",
        name: "TinyFish",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("tinyfish")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const headers = {
              "User-Agent": App.useragent(ctx.app),
              ...(credential?.type === "key"
                ? { "X-API-Key": credential.key }
                : { "X-TinyFish-Access-Mode": "keyless" }),
            }
            // Keyed requests are rejected without the `Mcp-Session-Id` returned by `initialize`; keyless ones are not.
            const session = credential?.type === "key" ? yield* initialize(http, headers) : undefined
            const result = yield* WebSearchMcp.call(
              http,
              endpoint,
              "search",
              { input: McpInput, output: McpOutput },
              { query: input.query },
              { ...headers, ...(session === undefined ? {} : { "Mcp-Session-Id": session }) },
            )
            const content = result?.content.find((item) => item.text)
            const response = content ? Option.getOrUndefined(decodeSearchResponse(content.text)) : undefined
            return (
              response?.results.map((item) => ({
                url: item.url,
                title: item.title,
                ...(item.snippet ? { content: item.snippet } : {}),
                time: {},
              })) ?? []
            )
          }),
      })
    })
  }),
})

const initialize = (http: HttpClient.HttpClient, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const client = HttpClient.withScope(HttpClient.filterStatusOk(http))
    const request = yield* HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(InitializeRequest)({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "opencode", version: "1.0" },
        },
      }),
    )
    const response = yield* client.execute(request)
    yield* collectBoundedResponseBody(
      response,
      WebSearchMcp.MAX_RESPONSE_BYTES,
      () => new Error(`initialize response exceeded ${WebSearchMcp.MAX_RESPONSE_BYTES} bytes`),
    )
    const session = response.headers["mcp-session-id"]
    if (session === undefined)
      return yield* Effect.fail(new Error("TinyFish MCP initialize did not return an Mcp-Session-Id header"))
    const notification = yield* HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders({ ...headers, "Mcp-Session-Id": session }),
      HttpClientRequest.schemaBodyJson(InitializedNotification)({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    )
    yield* client.execute(notification)
    return session
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: Duration.seconds(25),
      orElse: () => Effect.fail(new Error("TinyFish initialize request timed out")),
    }),
  )
