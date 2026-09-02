import { Form } from "@opencode-ai/core/form"
import { Location } from "@opencode-ai/core/location"
import { Session } from "@opencode-ai/core/session"
import {
  ConflictError,
  FormAlreadySettledError,
  FormInvalidAnswerError,
  FormNotFoundError,
  InvalidRequestError,
} from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestRef, response, sessionInfo } from "../location"

function missingForm(id: Form.ID) {
  return new FormNotFoundError({ id, message: `Form not found: ${id}` })
}

export const FormHandler = HttpApiBuilder.group(Api, "server.form", (handlers) =>
  Effect.gen(function* () {
    const form = yield* Form.Service
    const sessions = yield* Session.Service
    const requireOwnedForm = Effect.fnUntraced(function* (sessionID: Form.Info["sessionID"], formID: Form.ID) {
      const info = yield* form.get(formID).pipe(Effect.catchTag("Form.NotFoundError", () => missingForm(formID)))
      if (info.sessionID !== sessionID) return yield* missingForm(formID)
      return info
    })

    return handlers
      .handle(
        "form.request.list",
        Effect.fn(function* () {
          const location = yield* Location.Service
          return yield* response(
            form.list({ location: { directory: location.directory, workspaceID: location.workspaceID } }),
          )
        }),
      )
      .handle(
        "session.form.list",
        Effect.fn(function* (ctx) {
          // The `global` MCP elicitation owner is Location-scoped rather than session-owned.
          if (ctx.params.sessionID === "global") {
            return { data: yield* form.list({ sessionID: "global", location: requestRef(ctx.request) }) }
          }
          yield* sessionInfo(sessions, ctx.params.sessionID)
          return { data: yield* form.list({ sessionID: ctx.params.sessionID }) }
        }),
      )
      .handle(
        "session.form.create",
        Effect.fn(function* (ctx) {
          const created = yield* form
            .create({
              id: ctx.payload.id,
              sessionID: ctx.params.sessionID,
              title: ctx.payload.title,
              metadata: ctx.payload.metadata,
              fields: ctx.payload.fields,
            })
            .pipe(
              Effect.catchTags({
                "Form.AlreadyExistsError": (error) => new ConflictError({ resource: error.id, message: error.message }),
                "Form.InvalidFormError": (error) =>
                  new InvalidRequestError({ message: error.message, field: "fields" }),
              }),
            )
          return { data: created }
        }),
      )
      .handle(
        "session.form.get",
        Effect.fn(function* (ctx) {
          return { data: yield* requireOwnedForm(ctx.params.sessionID, ctx.params.formID) }
        }),
      )
      .handle(
        "session.form.state",
        Effect.fn(function* (ctx) {
          yield* requireOwnedForm(ctx.params.sessionID, ctx.params.formID)
          const data = yield* form
            .state(ctx.params.formID)
            .pipe(Effect.catchTag("Form.NotFoundError", () => missingForm(ctx.params.formID)))
          return { data }
        }),
      )
      .handle(
        "session.form.reply",
        Effect.fn(function* (ctx) {
          yield* requireOwnedForm(ctx.params.sessionID, ctx.params.formID)
          yield* form.reply({ id: ctx.params.formID, answer: ctx.payload.answer }).pipe(
            Effect.catchTags({
              "Form.AlreadySettledError": (error) =>
                new FormAlreadySettledError({ id: error.id, message: error.message }),
              "Form.InvalidAnswerError": (error) =>
                new FormInvalidAnswerError({ id: error.id, message: error.message }),
              "Form.NotFoundError": () => missingForm(ctx.params.formID),
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.form.cancel",
        Effect.fn(function* (ctx) {
          yield* requireOwnedForm(ctx.params.sessionID, ctx.params.formID)
          yield* form.cancel(ctx.params.formID).pipe(
            Effect.catchTags({
              "Form.AlreadySettledError": (error) =>
                new FormAlreadySettledError({ id: error.id, message: error.message }),
              "Form.NotFoundError": () => missingForm(ctx.params.formID),
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
