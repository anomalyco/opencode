import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Widget } from "@opencode/schema/widget"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import {
  MessageNotFoundError,
  SessionNotFoundError,
  WidgetAlreadyRespondedError,
  WidgetTemplateNotFoundError,
} from "../errors.js"

const experimental = (operation: { readonly tags?: ReadonlyArray<string> }) => ({
  ...operation,
  tags: ["experimental"],
})

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const WidgetEndpoints = [
  HttpApiEndpoint.get("widget.template.list", "/api/experimental/widget/template", {
    success: Schema.Struct({ data: Schema.Array(Widget.Summary) }),
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.widget.template.list",
      summary: "List widget templates",
      description:
        "List the latest version of every widget template, built-in and saved, without sources. Experimental: may change without compatibility guarantees.",
      transform: experimental,
    }),
  ),
  HttpApiEndpoint.get("widget.template.latest", "/api/experimental/widget/template/:name", {
    params: { name: Schema.String },
    success: Schema.Struct({ data: Widget.Program }),
    error: [WidgetTemplateNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.widget.template.latest",
      summary: "Get latest widget template",
      description:
        "Retrieve the latest version of a widget template with its source and runnable program. Experimental: may change without compatibility guarantees.",
      transform: experimental,
    }),
  ),
  HttpApiEndpoint.get("widget.template.get", "/api/experimental/widget/template/:name/:version", {
    params: { name: Schema.String, version: Schema.String },
    success: Schema.Struct({ data: Widget.Program }),
    error: [WidgetTemplateNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.widget.template.get",
      summary: "Get widget template version",
      description:
        "Retrieve one immutable widget template version with its source and runnable program. The response is cacheable forever by name and version. Experimental: may change without compatibility guarantees.",
      transform: experimental,
    }),
  ),
] as const

/** Lives in the `server.session` group next to the other `experimental.session.*` routes. */
export const WidgetRespondEndpoint = HttpApiEndpoint.post(
  "session.widget.respond",
  "/api/experimental/session/:sessionID/widget/:messageID/respond",
  {
    params: { sessionID: Session.ID, messageID: SessionMessage.ID },
    payload: Widget.Response,
    success: HttpApiSchema.NoContent,
    error: [SessionNotFoundError, MessageNotFoundError, WidgetAlreadyRespondedError],
  },
).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.session.widget.respond",
    summary: "Respond to widget",
    description:
      "Submit a value for, or dismiss, an open widget message. The response is recorded once and sent to the agent as the next prompt, which starts a turn. Experimental: may change without compatibility guarantees.",
  }),
)
