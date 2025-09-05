import { z } from "zod"
import { Bus } from "../bus"
import fs from "fs"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })

  export const Event = {
    Updated: Bus.event(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("rename"), z.literal("change")]),
      }),
    ),
  }
  const state = Instance.state(
    () => {
      if (Instance.project.vcs !== "git") return {}
      try {
        const watcher = fs.watch(Instance.directory, { recursive: true }, (event, file) => {
          log.info("change", { file, event })
          if (!file) return
          Bus.publish(Event.Updated, {
            file,
            event,
          })
        })
        return { watcher }
      } catch {
        return {}
      }
    },
    async (state) => {
      state.watcher?.close()
    },
  )

  export function init() {
    if (Flag.OPENCODE_DISABLE_WATCHER || true) return
    state()
  }
}
