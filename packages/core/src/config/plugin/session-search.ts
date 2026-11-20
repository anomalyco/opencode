export * as ConfigSessionSearchPlugin from "./session-search.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Flag } from "../../flag.js"
import { SessionSearchBuild } from "../../session/search-build.js"
import { ConfigEntryObserver } from "./entry-observer.js"

/** Starts the session search build once this location has the `sqlite_fts` flag on. Goes away with the flag. */
export const Plugin = define({
  id: "opencode.config.session-search",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const build = yield* SessionSearchBuild.Service
    const flags = yield* Flag.Service
    const apply = flags.enabled("sqlite_fts").pipe(Effect.flatMap((on) => (on ? build.start : Effect.void)))
    yield* ConfigEntryObserver.observe(config, ctx.event, apply)
    yield* apply
  }),
})
