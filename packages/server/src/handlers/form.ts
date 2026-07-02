import { Form } from "@opencode-ai/core/form"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import {
  ConflictError,
  FormAlreadySettledError,
  FormInvalidAnswerError,
  FormNotFoundError,
  InvalidRequestError,
} from "@opencode-ai/protocol/errors"
import { Api } from "../api"
import { response } from "../location"

function missingForm(id: Form.ID) {
  return new FormNotFoundError({ id, message: `Form not found: ${id}` })
}

function alreadySettled(error: Form.AlreadySettledError) {
  return new FormAlreadySettledError({ id: error.id, message: error.message })
}

function alreadyExists(error: Form.AlreadyExistsError) {
  return new ConflictError({ resource: error.id, message: error.message })
}

function invalidAnswer(error: Form.InvalidAnswerError) {
  return new FormInvalidAnswerError({ id: error.id, message: error.message })
}

export const FormHandler = HttpApiBuilder.group(Api, "server.form", (handlers) =>
  Effect.gen(function* () {
    const withOwnedForm = Effect.fnUntraced(function* <A, E>(
      sessionID: string,
      formID: Form.ID,
      use: (service: Form.Interface, info: Form.Info) => Effect.Effect<A, E>,
    ) {
      const form = yield* Form.Service
      const info = yield* form.get(formID).pipe(Effect.catchTag("Form.NotFoundError", () => missingForm(formID)))
      if (info.sessionID !== sessionID) return yield* missingForm(formID)
      return yield* use(form, info)
    })

    return handlers
      .handle(
        "form.request.list",
        Effect.fn(function* () {
          const form = yield* Form.Service
          return yield* response(form.list())
        }),
      )
      .handle(
        "session.form.list",
        Effect.fn(function* (ctx) {
          const form = yield* Form.Service
          return yield* response(form.list({ sessionID: ctx.params.sessionID }))
        }),
      )
      .handle(
        "session.form.create",
        Effect.fn(function* (ctx) {
          const form = yield* Form.Service
          if (ctx.payload.mode === "form") {
            if (!ctx.payload.fields) {
              return yield* new InvalidRequestError({ message: "Form fields are required", field: "fields" })
            }
            return yield* response(
              form.create({
                id: ctx.payload.id,
                sessionID: ctx.params.sessionID,
                title: ctx.payload.title,
                metadata: ctx.payload.metadata,
                mode: "form",
                fields: ctx.payload.fields,
              }).pipe(Effect.catchTag("Form.AlreadyExistsError", alreadyExists)),
            )
          }
          if (!ctx.payload.url) return yield* new InvalidRequestError({ message: "Form URL is required", field: "url" })
          return yield* response(
            form.create({
              id: ctx.payload.id,
              sessionID: ctx.params.sessionID,
              title: ctx.payload.title,
              metadata: ctx.payload.metadata,
              mode: "url",
              url: ctx.payload.url,
            }).pipe(Effect.catchTag("Form.AlreadyExistsError", alreadyExists)),
          )
        }),
      )
      .handle(
        "session.form.get",
        Effect.fn(function* (ctx) {
          return yield* response(withOwnedForm(ctx.params.sessionID, ctx.params.formID, (_, info) => Effect.succeed(info)))
        }),
      )
      .handle(
        "session.form.state",
        Effect.fn(function* (ctx) {
          return yield* response(
            withOwnedForm(ctx.params.sessionID, ctx.params.formID, (form) =>
              form.state(ctx.params.formID).pipe(Effect.catchTag("Form.NotFoundError", () => missingForm(ctx.params.formID))),
            ),
          )
        }),
      )
      .handle(
        "session.form.reply",
        Effect.fn(function* (ctx) {
          yield* withOwnedForm(ctx.params.sessionID, ctx.params.formID, (form) =>
            form.reply({ id: ctx.params.formID, answer: ctx.payload.answer }).pipe(
              Effect.catchTags({
                "Form.AlreadySettledError": alreadySettled,
                "Form.InvalidAnswerError": invalidAnswer,
                "Form.NotFoundError": () => missingForm(ctx.params.formID),
              }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.form.cancel",
        Effect.fn(function* (ctx) {
          yield* withOwnedForm(ctx.params.sessionID, ctx.params.formID, (form) =>
            form.cancel(ctx.params.formID).pipe(
              Effect.catchTags({
                "Form.AlreadySettledError": alreadySettled,
                "Form.NotFoundError": () => missingForm(ctx.params.formID),
              }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
