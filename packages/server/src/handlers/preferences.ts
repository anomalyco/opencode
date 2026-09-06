import { Preferences } from "@opencode-ai/core/preferences"
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
          .pipe(Effect.map((state) => (state === undefined ? null : { target: ctx.params, state }))),
      )
      .handle("preferences.set", (ctx) =>
        preferences.set(ctx.params, ctx.payload.state).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
      .handle("preferences.reset", (ctx) =>
        preferences.reset(ctx.params).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)
