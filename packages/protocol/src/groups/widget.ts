import { Location } from "@opencode/schema/location"
import { Widget } from "@opencode/schema/widget"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { FileNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const WidgetGroup = HttpApiGroup.make("server.widget")
  .add(
    HttpApiEndpoint.get("widget.list", "/api/widget", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Widget.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "widget.list",
          summary: "List widgets",
          description:
            "Retrieve user-authored widgets discovered from the config widgets directory and the project's .opencode/widgets folder, including any that failed to load.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("widget.read", "/api/widget/file/*", {
      query: LocationQuery,
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      error: FileNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "widget.read",
          summary: "Read widget asset",
          description:
            "Serve one widget asset. The path after /api/widget/file/ is `<id>/<asset>`; a missing asset falls back to the widget entry so single-page widgets keep working on reload.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "widget",
      description: "User-authored panel widgets.",
    }),
  )
