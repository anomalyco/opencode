import { Location } from "@opencode/schema/location"
import { Widget } from "@opencode/schema/widget"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { FileNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

// Widget assets are user-authored static files served from a public path so the
// frame can load them without a server credential. Only `/api/widget` (the list)
// stays behind authorization; the asset path is exempted the same way PTY
// connect tickets and pairing links are.
export const WIDGET_ASSET_PREFIX = "/widget/"
export const WIDGET_ASSET_ROUTE = "/widget/*"

export function isWidgetAssetURL(url: URL) {
  return url.pathname.startsWith(WIDGET_ASSET_PREFIX)
}

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
    HttpApiEndpoint.get("widget.read", WIDGET_ASSET_ROUTE, {
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
            "Serve one widget asset from a public path. The path after /widget/ is `<id>/<asset>`; a missing asset falls back to the widget entry so single-page widgets keep working on reload. This route is intentionally unauthenticated so a sandboxed widget frame can load its own files.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "widget",
      description: "User-authored panel widgets.",
    }),
  )
