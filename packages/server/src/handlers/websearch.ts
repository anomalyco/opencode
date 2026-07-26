import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { WebSearch } from "@opencode-ai/core/websearch"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const WebSearchHandler = HttpApiBuilder.group(Api, "server.websearch", (handlers) =>
  Effect.gen(function* () {
    const awaitPlugins = Effect.fn("server.websearch.awaitPlugins")(function* () {
      const plugins = yield* PluginSupervisor.Service
      yield* plugins.flush.pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () =>
            Effect.fail(
              new ServiceUnavailableError({
                message: "Web search provider initialization timed out",
                service: "websearch",
              }),
            ),
        }),
      )
    })
    return handlers
      .handle(
        "websearch.provider.list",
        Effect.fn("server.websearch.provider.list")(function* () {
          yield* awaitPlugins()
          const websearch = yield* WebSearch.Service
          return yield* response(websearch.list())
        }),
      )
      .handle(
        "websearch.provider.selected",
        Effect.fn("server.websearch.provider.selected")(function* () {
          const websearch = yield* WebSearch.Service
          return yield* response(websearch.selected())
        }),
      )
      .handle(
        "websearch.provider.select",
        Effect.fn("server.websearch.provider.select")(function* (request) {
          yield* awaitPlugins()
          const websearch = yield* WebSearch.Service
          yield* websearch.select(request.payload.providerID).pipe(
            Effect.mapError(
              (error) =>
                new InvalidRequestError({
                  message: `Web search provider not found: ${error.providerID}`,
                  kind: "websearch_provider_not_found",
                  field: "providerID",
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "websearch.query",
        Effect.fn("server.websearch.query")(function* (request) {
          yield* awaitPlugins()
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
                "WebSearch.Cancelled": () =>
                  new InvalidRequestError({ message: "Web search cancelled", kind: "websearch_cancelled" }),
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
