export * as VcsHgPlugin from "./hg.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { AppProcess } from "@opencode-ai/util/process"
import { Effect } from "effect"
import { Location } from "../../location.js"
import { VcsHg } from "../../vcs/hg.js"

export const Plugin = define({
  id: "opencode.vcs.hg",
  effect: Effect.fn("VcsHgPlugin")(function* (ctx) {
    const location = yield* Location.Service
    if (location.vcs?.type !== "hg") return

    const processes = yield* AppProcess.Service
    const fs = yield* FSUtil.Service
    const adapter = VcsHg.make(processes, fs, {
      directory: location.directory,
      worktree: location.project.directory,
    })

    yield* ctx.vcs.transform((draft) => {
      draft.add({
        id: "hg",
        name: "Mercurial",
        info: () => adapter.info(),
        branches: (input) => adapter.branches({ search: input.search, limit: input.limit }),
        status: () => adapter.status(),
        diff: (input) => adapter.diff(input.mode, { context: input.context }),
      })
    })
  }),
})
