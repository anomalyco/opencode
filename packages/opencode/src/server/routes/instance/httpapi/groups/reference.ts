import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const ReferenceDescriptor = Schema.Union([
  Schema.Struct({
    name: Schema.String,
    kind: Schema.Literal("local"),
    path: Schema.String,
  }),
  Schema.Struct({
    name: Schema.String,
    kind: Schema.Literal("git"),
    repository: Schema.String,
    path: Schema.String,
    branch: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    name: Schema.String,
    kind: Schema.Literal("invalid"),
    repository: Schema.optional(Schema.String),
    message: Schema.String,
  }),
]).annotate({ identifier: "ReferenceDescriptor" })

export const ReferenceApi = HttpApi.make("reference")
  .add(
    HttpApiGroup.make("reference")
      .add(
        HttpApiEndpoint.get("list", "/reference", {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ReferenceDescriptor), "Resolved configured references"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "reference.list",
            summary: "List configured references",
            description: "List configured references resolved in the current workspace.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "reference",
          description: "Configured reference routes.",
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
