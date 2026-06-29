import { Model } from "@opencode-ai/schema/model"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

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
  .annotateMerge(
    OpenApi.annotations({
      title: "models",
      description: "Experimental model routes.",
    }),
  )
