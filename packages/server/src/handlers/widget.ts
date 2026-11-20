import { Widget } from "@opencode/core/widget"
import {
  MessageNotFoundError,
  WidgetAlreadyRespondedError,
  WidgetTemplateNotFoundError,
} from "@opencode/protocol/errors"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Effect, Schema } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiSchema } from "effect/http-api"
import { missingSession } from "./session-error"

const ProgramResponse = Schema.Struct({ data: Widget.Program })

const missingTemplate = (error: Widget.TemplateNotFoundError) =>
  new WidgetTemplateNotFoundError({ template: error.name, version: error.version, message: error.message })

/** `widget.*` in the `server.experimental` group. */
export const makeWidget = Effect.gen(function* () {
  const widgets = yield* Widget.Service

  return {
    list: Effect.fn("WidgetHandler.list")(function* () {
      return { data: yield* widgets.list() }
    }),
    latest: Effect.fn("WidgetHandler.latest")(function* (name: string) {
      const template = yield* widgets.latest(name).pipe(Effect.mapError(missingTemplate))
      return { data: Widget.toProgram(template) }
    }),
    get: Effect.fn("WidgetHandler.get")(function* (name: string, version: string) {
      const template = yield* widgets.get(name, version).pipe(Effect.mapError(missingTemplate))
      // A version is a content address of the program, so clients may cache it forever.
      return yield* HttpServerResponse.schemaJson(ProgramResponse)(
        { data: Widget.toProgram(template) },
        { headers: { "cache-control": "public, max-age=31536000, immutable" } },
      ).pipe(Effect.orDie)
    }),
    respond: Effect.fn("WidgetHandler.respond")(function* (
      sessionID: Session.ID,
      messageID: SessionMessage.ID,
      response: Widget.Response,
    ) {
      yield* widgets.respond({ sessionID, messageID, response }).pipe(
        Effect.catchTags({
          "Session.NotFoundError": missingSession,
          "Session.MessageNotFoundError": (error) =>
            new MessageNotFoundError({
              sessionID: error.sessionID,
              messageID: error.messageID,
              message: `Widget message not found: ${error.messageID}`,
            }),
          "Widget.AlreadyRespondedError": (error) =>
            new WidgetAlreadyRespondedError({
              sessionID: error.sessionID,
              messageID: error.messageID,
              status: error.status,
              message: error.message,
            }),
        }),
      )
      return HttpApiSchema.NoContent.make()
    }),
  }
})
