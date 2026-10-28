export * as ConfigFormatterPlugin from "./formatter.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import type { ConfigFormatter } from "@opencode/schema/config/formatter"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Formatter } from "../../formatter.js"
import { make, type Info } from "../../formatter/builtins.js"
import { Location } from "../../location.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.formatter",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const formatter = yield* Formatter.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const npm = yield* Npm.Service
    const processes = yield* AppProcess.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, formatter.reload())

    yield* formatter.transform((editor) => {
      const configured = resolve(loaded.entries)
      if (!configured) return
      const builtIns = make({
        directory: location.directory,
        worktree: location.project.directory,
        fs,
        npm,
        processes,
        bin: global.bin,
      })
      builtIns.forEach(editor.set)
      if (configured === true) return

      for (const [name, entry] of Object.entries(configured)) {
        if (entry.disabled) {
          editor.remove(name)
          continue
        }
        const builtIn = builtIns.find((formatter) => formatter.name === name)
        const current: Info = {
          name,
          extensions: entry.extensions ?? builtIn?.extensions ?? [],
          environment: { ...builtIn?.environment, ...entry.environment },
          enabled:
            builtIn && !entry.command ? builtIn.enabled : Effect.succeed(entry.command ? [...entry.command] : false),
        }
        editor.set(current)
      }
    })
  }),
})

// Documents apply from lowest to highest priority. A boolean resets everything before it; an object
// merges each named formatter's supplied fields over the same name from earlier objects.
function resolve(entries: readonly Entry[]) {
  return entries.reduce<boolean | Record<string, ConfigFormatter.Entry> | undefined>((result, entry) => {
    if (entry.type !== "document" || entry.info.formatter === undefined) return result
    if (typeof entry.info.formatter === "boolean") return entry.info.formatter
    return Object.entries(entry.info.formatter).reduce(
      (merged, [name, item]) => ({
        ...merged,
        [name]: { ...merged[name], ...item, environment: { ...merged[name]?.environment, ...item.environment } },
      }),
      typeof result === "object" ? result : {},
    )
  }, undefined)
}
