import { responseSchema } from "@/usage/types"
import { Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/usage"
const QueryRefresh = Schema.String.check(Schema.isPattern(/^\s*(true|false|1|0)\s*$/i)).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => {
      const normalized = value.trim().toLowerCase()
      return normalized === "true" || normalized === "1"
    }),
    encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
  }),
)

export const UsageQuerySchema = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  provider: Schema.optional(Schema.String),
  refresh: Schema.optional(QueryRefresh),
})
export const UsagePaths = {
  get: root,
} as const

export const UsageApi = HttpApi.make("usage")
  .add(
    HttpApiGroup.make("usage")
      .add(
        HttpApiEndpoint.get("get", UsagePaths.get, {
          query: UsageQuerySchema,
          success: described(responseSchema, "Usage response"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "usage.get",
            summary: "Get usage",
            description: "Fetch usage limits for authenticated providers.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "usage",
          description: "Experimental HttpApi usage routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
