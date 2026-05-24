import { ModelV2 } from "@opencode-ai/core/model"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../../errors"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

export const ModelGroup = HttpApiGroup.make("v2.model")
  .add(
    HttpApiEndpoint.get("models", "/api/model", {
      query: LocationQuery,
      success: Schema.Array(ModelV2.Info),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.model.list",
          summary: "List v2 models",
          description: "Retrieve available v2 models ordered by release date.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 models",
      description: "Experimental v2 model routes.",
    }),
  )
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)
