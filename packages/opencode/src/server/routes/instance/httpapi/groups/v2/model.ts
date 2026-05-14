import { ModelV2 } from "@opencode-ai/core/model"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"
import { InstanceQuery, instanceQueryOpenApi, V2InstanceMiddleware } from "./instance"

export const ModelGroup = HttpApiGroup.make("v2.model")
  .add(
    HttpApiEndpoint.get("models", "/api/model", {
      query: InstanceQuery,
      success: Schema.Array(ModelV2.Info),
    })
      .annotateMerge(instanceQueryOpenApi)
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
  .middleware(V2InstanceMiddleware)
  .middleware(Authorization)
