import { Settings } from "@opencode/core/settings"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const SettingsHandler = HttpApiBuilder.group(Api, "server.settings", (handlers) =>
  Effect.gen(function* () {
    const settings = yield* Settings.Service
    return handlers
      .handle("settings.list", () => settings.list())
      .handle("settings.get", (ctx) =>
        settings
          .get(ctx.params)
          .pipe(Effect.map((value) => (value === undefined ? null : { target: ctx.params, value }))),
      )
      .handle("settings.set", (ctx) =>
        settings.set(ctx.params, ctx.payload.value).pipe(
          Effect.catchTag(
            "Settings.InvalidValue",
            (error) => new InvalidRequestError({ message: error.message, field: "value" }),
          ),
          Effect.as(HttpApiSchema.NoContent.make()),
        ),
      )
      .handle("settings.reset", (ctx) =>
        settings.reset(ctx.params).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)
