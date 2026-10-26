import { Model } from "@opencode/schema/model"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const ListQuery = Schema.Struct({
  ...LocationQuery.fields,
  type: Schema.optional(Model.Type).annotate({
    description: "Model type to list. Defaults to chat, the only type offered for sessions.",
  }),
})

export const ModelGroup = HttpApiGroup.make("server.model")
  .add(
    HttpApiEndpoint.get("model.list", "/api/model", {
      query: ListQuery,
      success: Location.response(Schema.Array(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "model.list",
          summary: "List models",
          description:
            "Retrieve the current snapshot of available models of one type, chat by default, ordered by release date. The snapshot may precede initial plugin settlement.",
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
          identifier: "model.default",
          summary: "Get default model",
          description: "Retrieve the model used when a session has no explicit model selection.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "model",
      description: "Experimental model routes.",
    }),
  )
