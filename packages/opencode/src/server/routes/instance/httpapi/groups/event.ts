import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingQuery } from "../middleware/workspace-routing"

export const EventPaths = {
  event: "/event",
} as const

export const EventApi = HttpApi.make("event").add(
  HttpApiGroup.make("event")
    .add(
      HttpApiEndpoint.get("subscribe", EventPaths.event, {
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "event.subscribe",
          summary: "Subscribe to events",
          description: "Get events",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "event", description: "Instance event stream route." })),
)
