import { Model } from "@opencode-ai/schema/model"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ModelGroup = HttpApiGroup.make("server.model")
  .add(
    HttpApiEndpoint.get("model.list", "/api/model", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.model.list",
          summary: "List models",
          description: "Retrieve available models ordered by release date.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("model.default", "/api/model/default", {
      query: LocationQuery,
      success: Location.response(Schema.UndefinedOr(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.model.default",
          summary: "Get default model",
          description: "Retrieve the model used when a session has no explicit model selection.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "models",
      description: "Experimental model routes.",
    }),
  )
