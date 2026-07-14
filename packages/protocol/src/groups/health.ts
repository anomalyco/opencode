import { Effect, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export namespace ServiceStatus {
  export const State = Schema.Union([
    Schema.Struct({ type: Schema.Literal("starting") }),
    Schema.Struct({ type: Schema.Literal("ready") }),
    Schema.Struct({
      type: Schema.Literal("stopping"),
      targetVersion: Schema.String.pipe(Schema.optional),
    }),
    Schema.Struct({
      type: Schema.Literal("failed"),
      message: Schema.String,
      action: Schema.String,
    }),
  ]).annotate({ identifier: "ServiceStatus" })
  export type State = typeof State.Type

  export const Health = Schema.Struct({
    healthy: Schema.Literal(true),
    version: Schema.String,
    pid: Schema.Int.check(Schema.isGreaterThan(0)),
    instanceID: Schema.String.pipe(Schema.optional),
    status: State.pipe(Schema.withDecodingDefaultKey(Effect.succeed({ type: "ready" as const }))),
  }).annotate({ identifier: "ServiceHealth" })
  export type Health = typeof Health.Type

  export const StopRequest = Schema.Struct({
    instanceID: Schema.String,
    targetVersion: Schema.String.pipe(Schema.optional),
  }).annotate({ identifier: "ServiceStopRequest" })
  export type StopRequest = typeof StopRequest.Type

  export const StopResponse = Schema.Struct({
    accepted: Schema.Boolean,
  }).annotate({ identifier: "ServiceStopResponse" })
  export type StopResponse = typeof StopResponse.Type
}

export const HealthGroup = HttpApiGroup.make("server.health")
  .add(
    HttpApiEndpoint.get("health.get", "/api/health", {
      success: ServiceStatus.Health,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.health.get",
        summary: "Check server health",
        description: "Report the owning server process and its application status.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("health.stop", "/api/service/stop", {
      payload: ServiceStatus.StopRequest,
      success: ServiceStatus.StopResponse,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.health.stop",
        summary: "Stop the managed server",
        description: "Request graceful shutdown of one exact managed server instance.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "health" }))
