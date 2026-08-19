import { Workflow } from "@opencode-ai/schema/workflow"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export class WorkflowError extends Schema.ErrorClass<WorkflowError>("WorkflowError")(
  {
    name: Schema.Literal("WorkflowError"),
    data: Schema.Struct({
      message: Schema.String,
      workflowID: Workflow.ID.pipe(Schema.optional),
      taskID: Schema.String.pipe(Schema.optional),
      role: Schema.Literals(["architect", "coder"]).pipe(Schema.optional),
      from: Schema.String.pipe(Schema.optional),
      to: Schema.String.pipe(Schema.optional),
      reason: Schema.String.pipe(Schema.optional),
      dependency: Schema.String.pipe(Schema.optional),
    }),
  },
  { httpApiStatus: 400 },
) {}

export const WorkflowGroup = HttpApiGroup.make("server.workflow")
  .add(
    HttpApiEndpoint.get("workflow.preferences.get", "/api/workflow/preferences", {
      query: LocationQuery,
      success: Schema.Struct({ data: Workflow.Preferences }),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.preferences.get" })),
  )
  .add(
    HttpApiEndpoint.put("workflow.preferences.update", "/api/workflow/preferences", {
      query: LocationQuery,
      payload: Workflow.PreferencesInput,
      success: Schema.Struct({ data: Workflow.Preferences }),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.preferences.update" })),
  )
  .add(
    HttpApiEndpoint.post("workflow.create", "/api/workflow", {
      query: LocationQuery,
      payload: Workflow.CreateInput,
      success: Schema.Struct({ data: Workflow.Info }),
      error: WorkflowError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.create" })),
  )
  .add(
    HttpApiEndpoint.get("workflow.list", "/api/workflow", {
      query: LocationQuery,
      success: Schema.Struct({ data: Schema.Array(Workflow.Info) }),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.list" })),
  )
  .add(
    HttpApiEndpoint.get("workflow.get", "/api/workflow/:workflowID", {
      params: { workflowID: Workflow.ID },
      success: Schema.Struct({ data: Workflow.Info }),
      error: WorkflowError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.get" })),
  )
  .add(
    HttpApiEndpoint.post("workflow.pause", "/api/workflow/:workflowID/pause", {
      params: { workflowID: Workflow.ID },
      success: Schema.Struct({ data: Workflow.Info }),
      error: WorkflowError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.pause" })),
  )
  .add(
    HttpApiEndpoint.post("workflow.resume", "/api/workflow/:workflowID/resume", {
      params: { workflowID: Workflow.ID },
      success: Schema.Struct({ data: Workflow.Info }),
      error: WorkflowError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.resume" })),
  )
  .add(
    HttpApiEndpoint.post("workflow.cancel", "/api/workflow/:workflowID/cancel", {
      params: { workflowID: Workflow.ID },
      success: Schema.Struct({ data: Workflow.Info }),
      error: WorkflowError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.workflow.cancel" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "workflow", description: "Architect-Coder workflow routes." }))

export const makeWorkflowGroup = <I extends HttpApiMiddleware.AnyId, S>(locationMiddleware: Context.Key<I, S>) =>
  WorkflowGroup.middleware(locationMiddleware)
