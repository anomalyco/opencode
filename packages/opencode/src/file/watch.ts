import { z } from "zod"
import { Bus } from "../bus"
import fs from "fs"
import { App } from "../app/app"
import { Log } from "../util/log"

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

  export function init() {
    App.state(
      "file.watcher",
      () => {
        const app = App.use()
        try {
          const watcher = fs.watch(
            app.info.path.cwd,
            { recursive: true },
            (event, file) => {
              log.info("change", { file, event })
              if (!file) return
              // for some reason async local storage is lost here
              // https://github.com/oven-sh/bun/issues/20754
              App.provideExisting(app, async () => {
                Bus.publish(Event.Updated, {
                  file,
                  event,
                })
              })
            },
          )
          return { watcher }
        } catch {
          return {}
        }
      },
      async (state) => {
        state.watcher?.close()
      },
    )()
  }
}
