import { z } from "zod"
import { Bus } from "../bus"
import chokidar from "chokidar"
import { App } from "../app/app"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"

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
  const state = App.state(
    "file.watcher",
    () => {
      const app = App.use()
      if (!app.info.git) return {}
      try {
        let watcher = chokidar.watch(app.info.path.cwd, { ignoreInitial: true })
        watcher.on('change', file => {
          log.info("change", { file, event: "change" })
          if (!file) return
          // for some reason async local storage is lost here
          // https://github.com/oven-sh/bun/issues/20754
          App.provideExisting(app, async () =>
            Bus.publish(Event.Updated, { file, event: "change", })
          )
        })
        return { watcher  }
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
