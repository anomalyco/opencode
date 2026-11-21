import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option } from "effect"
import { AntigravityAISDK } from "./aisdk.js"
import { AntigravitySession } from "./antigravity/session.js"
import { AntigravityProvider } from "./provider.js"
import { Environment } from "../../../environment/index.js"
import { EnvironmentUnavailable } from "../../../environment/unavailable.js"
import { Location } from "../../../location.js"
import type { PluginInternal } from "../../internal.js"

export const ID = "opencode.provider.antigravity"

export const make = define({
  id: ID,
  effect: Effect.fn("Antigravity.Plugin")(function* (ctx) {
    // The Antigravity CLI runs locally, so skip it where opencode cannot start local programs.
    const environment = yield* Effect.serviceOption(Environment.Service)
    const location = yield* Effect.serviceOption(Location.Service)
    if (Option.isSome(location) && location.value.workspaceID !== undefined) return
    if (Option.isSome(environment) && environment.value.spawner === EnvironmentUnavailable.spawner) return

    // The models come from the account, and the CLI is only run to ask it. The
    // list opencode kept from last time is registered first, so the picker has
    // the models before the CLI answers, and the CLI is asked in the background.
    const session = AntigravitySession.make({ directory: ctx.location.directory })
    const known = AntigravityProvider.groups(yield* AntigravityProvider.cached(ctx))
    yield* AntigravityProvider.register(ctx, known.length > 0 ? known : session.groups())
    yield* AntigravityAISDK.register(ctx, session)

    yield* Effect.forkScoped(
      Effect.tryPromise({
        try: () => session.refresh(),
        catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
      }).pipe(
        Effect.flatMap((groups) =>
          Effect.gen(function* () {
            if (groups.length === 0) {
              yield* Effect.logWarning("Antigravity: the CLI reported no models for this account")
              return
            }
            yield* AntigravityProvider.remember(ctx, groups)
            yield* AntigravityProvider.register(ctx, groups)
            yield* ctx.provider.reload()
          }),
        ),
        Effect.catch((cause) => Effect.logWarning(`Antigravity: ${cause.message}`)),
      ),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

export const AntigravityPlugin = make
