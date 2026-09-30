import { Widget } from "@opencode/core/widget"
import { FileNotFoundError } from "@opencode/protocol/errors"
import { WIDGET_ASSET_PREFIX } from "@opencode/protocol/groups/widget"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const WidgetHandler = HttpApiBuilder.group(Api, "server.widget", (handlers) =>
  handlers
    .handle("widget.list", () => response(Widget.Service.use((widget) => widget.list())))
    .handleRaw("widget.read", (ctx) =>
      Effect.gen(function* () {
        const widget = yield* Widget.Service
        const pathname = decodeURIComponent(new URL(ctx.request.url, "http://localhost").pathname)
        const rest = pathname.startsWith(WIDGET_ASSET_PREFIX) ? pathname.slice(WIDGET_ASSET_PREFIX.length) : ""
        const separator = rest.indexOf("/")
        const id = separator === -1 ? rest : rest.slice(0, separator)
        const asset = separator === -1 ? "" : rest.slice(separator + 1)
        const file = yield* widget.read(id, asset).pipe(
          Effect.mapError(() => new FileNotFoundError({ path: pathname, message: `Widget asset not found: ${pathname}` })),
        )
        if (!file)
          return yield* new FileNotFoundError({ path: pathname, message: `Widget asset not found: ${pathname}` })
        return HttpServerResponse.uint8Array(file.body, { contentType: file.mime })
      }),
    ),
)
