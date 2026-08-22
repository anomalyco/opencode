import { WebSearch } from "@opencode-ai/core/websearch"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { pluginReadiness } from "./plugin-readiness"

const awaitPlugins = pluginReadiness(
  () =>
    new ServiceUnavailableError({
      message: "Web search provider initialization timed out",
      service: "websearch",
    }),
).pipe(Effect.withSpan("server.websearch.awaitPlugins"))

export const WebSearchHandler = HttpApiBuilder.group(Api, "server.websearch", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "websearch.providers",
        Effect.fn("server.websearch.providers")(function* () {
          yield* awaitPlugins
          const websearch = yield* WebSearch.Service
          return yield* response(websearch.providers())
        }),
      )
      .handle(
        "websearch.query",
        Effect.fn("server.websearch.query")(function* (request) {
          yield* awaitPlugins
          const websearch = yield* WebSearch.Service
          return yield* response(
            websearch.query(request.payload).pipe(
              Effect.catchTags({
                "WebSearch.ProviderRequired": () =>
                  new InvalidRequestError({
                    message: "Web search provider is required",
                    kind: "websearch_provider_required",
                    field: "providerID",
                  }),
                "WebSearch.ProviderNotFound": (error) =>
                  new InvalidRequestError({
                    message: `Web search provider not found: ${error.providerID}`,
                    kind: "websearch_provider_not_found",
                    field: "providerID",
                  }),
                "WebSearch.Disabled": () =>
                  new InvalidRequestError({ message: "Web search is disabled", kind: "websearch_disabled" }),
                "WebSearch.Request": (error) =>
                  new ServiceUnavailableError({
                    message: `Web search request failed: ${error.providerID}`,
                    service: error.providerID,
                  }),
              }),
            ),
          )
        }),
      )
  }),
)
