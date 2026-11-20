export * as ConfigSessionSearchPlugin from "./session-search.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Flag } from "../../flag.js"
import { SessionSearchBuild } from "../../session/search-build.js"

/** Starts the session search build once this location has the `sqlite_fts` flag on. Goes away with the flag. */
export const Plugin = define({
  id: "opencode.config.session-search",
  effect: Effect.fn(function* (ctx) {
    const build = yield* SessionSearchBuild.Service
    const flags = yield* Flag.Service
    const apply = flags.enabled("sqlite_fts").pipe(Effect.flatMap((on) => (on ? build.start : Effect.void)))
    yield* ctx.event.subscribe({ types: ["config.updated"] }).pipe(
      Stream.runForEach(() => apply),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* apply
  }),
})
