import { $ } from "bun"
import z from "zod"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { Instance } from "./instance"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    Changed: Bus.event(
      "vcs.changed",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  async function fetchBranch() {
    return $`git rev-parse --abbrev-ref HEAD`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .then((x) => x.trim())
      .catch(() => undefined)
  }

  const state = Instance.state(async () => {
    if (Instance.project.vcs !== "git") {
      return { branch: async () => undefined }
    }
    let current = await fetchBranch()
    // TODO: when file watcher is added, set watching: true and skip refetch in branch()
    const watching = false
    log.info("initialized", { branch: current })
    return {
      branch: async () => {
        if (watching) return current
        const next = await fetchBranch()
        if (next !== current) {
          log.info("branch changed", { from: current, to: next })
          current = next
          Bus.publish(Event.Changed, { branch: next })
        }
        return current
      },
    }
  })

  export async function init() {
    return state()
  }

  export async function branch() {
    return state().then((s) => s.branch())
  }
}
