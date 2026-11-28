import { define } from "@opencode/plugin/effect/plugin"
import type { AssertInput } from "@opencode/plugin/permission"
import { Effect, Exit, Option, Stream } from "effect"
import { AntigravityAISDK } from "./aisdk.js"
import { AntigravitySession } from "./antigravity/session.js"
import { AntigravityProvider } from "./provider.js"
import { AntigravitySessionHooks } from "./session-hooks.js"
import { Environment } from "../../../environment/index.js"
import { EnvironmentUnavailable } from "../../../environment/unavailable.js"
import { Location } from "../../../location.js"
import { which } from "../../../util/which.js"
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

    const context = yield* Effect.context<never>()
    const run = Effect.runPromiseWith(context)
    const known = AntigravityProvider.groups(yield* AntigravityProvider.cached(ctx))
    const session = AntigravitySession.make({
      directory: ctx.location.directory,
      initial: known,
      assert: (check) =>
        run(Effect.exit(ctx.permission.assert(check as AssertInput))).then(Exit.isSuccess, () => false),
      onModels: (groups) =>
        void run(
          Effect.gen(function* () {
            yield* AntigravityProvider.remember(ctx, groups)
            yield* ctx.provider.reload()
          }).pipe(Effect.catchCause((cause) => Effect.logWarning("Antigravity: could not update the models", cause))),
        ),
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => session.close()))

    yield* AntigravityProvider.register(ctx, session.groups)
    yield* AntigravityAISDK.register(ctx, session)
    yield* AntigravitySessionHooks.register(ctx)
    yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
      Stream.runForEach((event) => Effect.promise(() => session.remove(event.data.sessionID))),
      Effect.forkScoped({ startImmediately: true }),
    )

    // With a cached model list the CLI waits for the first turn. Without one it is asked now, and only
    // when it is installed, so a machine without it logs nothing.
    if (known.length > 0 || !which("agy")) return
    yield* Effect.tryPromise(() => session.refresh()).pipe(
      Effect.catch((error) => Effect.logWarning("Antigravity: could not list the models", error)),
      Effect.forkScoped,
    )
  }),
} satisfies PluginInternal.InternalPlugin)

export const AntigravityPlugin = make
