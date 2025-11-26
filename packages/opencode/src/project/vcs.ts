import { $ } from "bun"
import { watch, type FSWatcher } from "fs"
import path from "path"
import z from "zod"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { Instance } from "./instance"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    BranchUpdated: Bus.event(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  async function currentBranch() {
    return $`git rev-parse --abbrev-ref HEAD`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .then((x) => x.trim())
      .catch(() => undefined)
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
        return { branch: async () => undefined, watcher: undefined }
      }
      let current = await currentBranch()
      log.info("initialized", { branch: current })

      const gitDir = await $`git rev-parse --git-dir`
        .quiet()
        .nothrow()
        .cwd(Instance.worktree)
        .text()
        .then((x) => x.trim())
        .catch(() => undefined)
      if (!gitDir) {
        log.warn("failed to resolve git directory")
        return { branch: async () => current, watcher: undefined }
      }

      const gitHead = path.join(gitDir, "HEAD")
      let watcher: FSWatcher | undefined
      // we should probably centralize file watching (see watcher.ts)
      // but parcel still marked experimental rn
      try {
        watcher = watch(gitHead, async () => {
          const next = await currentBranch()
          if (next !== current) {
            log.info("branch changed", { from: current, to: next })
            current = next
            Bus.publish(Event.BranchUpdated, { branch: next })
          }
        })
        log.info("watching", { path: gitHead })
      } catch (e) {
        log.warn("failed to watch git HEAD", { error: e })
      }

      return {
        branch: async () => current,
        watcher,
      }
    },
    async (state) => {
      state.watcher?.close()
    },
  )

  export async function init() {
    return state()
  }

  export async function branch() {
    return await state().then((s) => s.branch())
  }
}
