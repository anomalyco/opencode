export * as ConfigWorktreePlugin from "./worktree.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { FileAccess } from "../../file-access.js"
import { Global } from "@opencode/util/global"
import { Location } from "../../location.js"
import { AbsolutePath } from "../../schema.js"
import { WorktreeStrategies } from "../../worktree/strategies.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.worktree",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const global = yield* Global.Service
    const worktrees = yield* WorktreeStrategies.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, worktrees.reload())
    yield* worktrees.transform((editor) => {
      for (const entry of loaded.entries) {
        if (entry.type !== "document" || !entry.info.worktree) continue
        const directory = entry.info.worktree.directory
        editor.configure({
          directory: AbsolutePath.make(FileAccess.resolvePath(location.project.canonical, directory, global.home)),
        })
      }
    })
  }),
})
