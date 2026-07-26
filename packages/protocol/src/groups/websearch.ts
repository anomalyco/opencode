import { Location } from "@opencode-ai/schema/location"
import { WebSearch } from "@opencode-ai/schema/websearch"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const WebSearchGroup = HttpApiGroup.make("server.websearch")
  .add(
    HttpApiEndpoint.get("websearch.provider.list", "/api/websearch/provider", {
      query: LocationQuery,
      success: Location.response(Schema.Array(WebSearch.Provider)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.websearch.provider.list",
          summary: "List web search providers",
          description: "Return the registered web search providers.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("websearch.provider.selected", "/api/websearch/provider/selected", {
      query: LocationQuery,
      success: Location.response(Schema.UndefinedOr(WebSearch.ID)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.websearch.provider.selected",
          summary: "Get selected web search provider",
          description: "Return the globally selected web search provider.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("websearch.provider.select", "/api/websearch/provider/selected", {
      query: LocationQuery,
      payload: Schema.Struct({ providerID: WebSearch.ID }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.websearch.provider.select",
          summary: "Select default web search provider",
          description: "Persist the global web search provider in the user configuration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("websearch.query", "/api/websearch", {
      query: LocationQuery,
      payload: Schema.Struct(WebSearch.Input.fields),
      success: Location.response(WebSearch.Result),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.websearch.query",
          summary: "Search the web",
          description:
            "Run one web search through the selected provider. Specify a provider to override the configured default.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "websearch",
      description: "Location-scoped web search routes.",
    }),
  )
