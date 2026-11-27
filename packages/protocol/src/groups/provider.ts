import { Provider } from "@opencode/schema/provider"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError, ProviderNotFoundError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ProviderGroup = HttpApiGroup.make("server.provider")
  .add(
    HttpApiEndpoint.get("provider.list", "/api/provider", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Provider.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.list",
          summary: "List providers",
          description: "Retrieve active AI providers so clients can show provider availability and configuration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider.get", "/api/provider/:providerID", {
      params: { providerID: Provider.ID },
      query: LocationQuery,
      success: Location.response(Provider.Info),
      error: [ProviderNotFoundError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.get",
          summary: "Get provider",
          description: "Retrieve a single AI provider so clients can inspect its availability and endpoint settings.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("provider.custom.create", "/api/experimental/provider/custom", {
      query: LocationQuery,
      payload: Provider.Custom,
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ConflictError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.provider.custom.create",
          summary: "Create custom provider",
          description:
            "Add an OpenAI- or Anthropic-compatible provider to the global configuration and store its API key as a credential. Experimental: may change without compatibility guarantees.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "provider",
      description: "Experimental provider routes.",
    }),
  )
