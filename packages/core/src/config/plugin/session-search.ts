export * as ConfigSessionSearchPlugin from "./session-search.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Exit, Scope } from "effect"
import { Config } from "../../config.js"
import { SessionSearchBuild } from "../../session/search-build.js"
import { ConfigEntryObserver } from "./entry-observer.js"

/** While this location has `experimental.sqlite_fts` on, it holds the session search build. */
export const Plugin = define({
  id: "opencode.config.session-search",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const build = yield* SessionSearchBuild.Service
    const scope = yield* Scope.Scope
    const held = { scope: undefined as Scope.Closeable | undefined }
    const apply = Effect.gen(function* () {
      const on = Config.latest(loaded.entries, "experimental")?.sqlite_fts === true
      if (on && !held.scope) {
        const child = yield* Scope.fork(scope)
        yield* build.hold.pipe(Scope.provide(child))
        held.scope = child
      }
      if (!on && held.scope) {
        yield* Scope.close(held.scope, Exit.void)
        held.scope = undefined
      }
    })
    const loaded = yield* ConfigEntryObserver.observe(
      config,
      ctx.event,
      Effect.suspend(() => apply),
    )
    yield* apply
  }),
})
