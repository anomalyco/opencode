import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"

export class Missing extends Schema.TaggedErrorClass<Missing>()("Missing", {
  message: Schema.String,
}) {}

export const Api = HttpApi.make("fixture")
  .add(
    HttpApiGroup.make("session")
      .add(HttpApiEndpoint.get("health", "/session/health", { success: Schema.String }))
      .add(
        HttpApiEndpoint.get("list", "/session", {
          query: { archived: Schema.optional(Schema.Boolean) },
          success: Schema.Array(Schema.String),
        }),
      )
      .add(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.Struct({ data: Schema.String }),
          error: Missing.pipe(HttpApiSchema.status(404)),
        }),
      )
      .add(
        HttpApiEndpoint.post("interrupt", "/session/:sessionID/interrupt", {
          params: { sessionID: Schema.String },
          success: HttpApiSchema.NoContent,
        }),
      ),
  )
  .add(
    HttpApiGroup.make("event").add(
      HttpApiEndpoint.get("subscribe", "/event", {
        success: HttpApiSchema.StreamSse({ data: Schema.Struct({ type: Schema.String }) }).pipe(
          HttpApiSchema.status(202),
        ),
      }),
    ),
  )
  .add(
    HttpApiGroup.make("system", { topLevel: true }).add(
      HttpApiEndpoint.get("status", "/status", { success: Schema.String }),
    ),
  )
