import { Preferences } from "@opencode-ai/core/preferences"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const PreferencesHandler = HttpApiBuilder.group(Api, "server.preferences", (handlers) =>
  Effect.gen(function* () {
    const preferences = yield* Preferences.Service
    return handlers
      .handle("preferences.list", () => preferences.list())
      .handle("preferences.get", (ctx) =>
        preferences
          .get(ctx.params)
          .pipe(Effect.map((value) => (value === undefined ? null : { target: ctx.params, value }))),
      )
      .handle("preferences.set", (ctx) =>
        preferences.set(ctx.params, ctx.payload.value).pipe(
          Effect.catchTag(
            "Preferences.InvalidValue",
            (error) => new InvalidRequestError({ message: error.message, field: "value" }),
          ),
          Effect.as(HttpApiSchema.NoContent.make()),
        ),
      )
      .handle("preferences.reset", (ctx) =>
        preferences.reset(ctx.params).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)
