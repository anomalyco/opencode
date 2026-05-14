import { ProviderV2 } from "@opencode-ai/core/provider"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../../errors"
import { Authorization } from "../../middleware/authorization"
import { InstanceQuery, instanceQueryOpenApi, V2InstanceMiddleware } from "./instance"

export const ProviderGroup = HttpApiGroup.make("v2.provider")
  .add(
    HttpApiEndpoint.get("providers", "/api/provider", {
      query: InstanceQuery,
      success: Schema.Array(ProviderV2.Info),
    })
      .annotateMerge(instanceQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.list",
          summary: "List v2 providers",
          description: "Retrieve active v2 AI providers so clients can show provider availability and configuration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider", "/api/provider/:providerID", {
      params: { providerID: ProviderV2.ID },
      query: InstanceQuery,
      success: ProviderV2.Info,
      error: ApiNotFoundError,
    })
      .annotateMerge(instanceQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.get",
          summary: "Get v2 provider",
          description:
            "Retrieve a single v2 AI provider so clients can inspect its availability and endpoint settings.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 providers",
      description: "Experimental v2 provider routes.",
    }),
  )
  .middleware(V2InstanceMiddleware)
  .middleware(Authorization)
