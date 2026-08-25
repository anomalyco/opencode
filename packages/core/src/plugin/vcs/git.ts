export * as VcsGitPlugin from "./git.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { AppProcess } from "@opencode-ai/util/process"
import { Effect } from "effect"
import { Location } from "../../location.js"
import { VcsGit } from "../../vcs/git.js"

export const Plugin = define({
  id: "opencode.vcs.git",
  effect: Effect.fn("VcsGitPlugin")(function* (ctx) {
    const location = yield* Location.Service
    if (location.vcs?.type !== "git") return

    const processes = yield* AppProcess.Service
    const adapter = VcsGit.make(processes, {
      directory: location.directory,
      worktree: location.project.directory,
    })

    yield* ctx.vcs.transform((draft) => {
      draft.add({
        id: "git",
        name: "Git",
        info: () => adapter.info(),
        branches: (input) => adapter.branches({ search: input.search, limit: input.limit }),
        status: () => adapter.status(),
        diff: (input) => adapter.diff(input.mode, { context: input.context }),
      })
    })
  }),
})
