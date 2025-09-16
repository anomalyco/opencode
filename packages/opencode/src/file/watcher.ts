import z from "zod/v4"
import { Bus } from "../bus"
import chokidar from "chokidar"
import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })

  export const Event = {
    Updated: Bus.event(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") return {}
      log.info("init")
      const cfg = await Config.get()
      const ignore = (cfg.watcher?.ignore ?? []).map((v) => new Bun.Glob(v))
      const watcher = chokidar.watch(Instance.directory, {
        ignoreInitial: true,
        awaitWriteFinish: true,
        ignored: (filepath) => {
          return FileIgnore.match(filepath, {
            extra: ignore,
          })
        },
      })
      watcher.on("change", (file) => {
        Bus.publish(Event.Updated, { file, event: "change" })
      })
      watcher.on("add", (file) => {
        Bus.publish(Event.Updated, { file, event: "add" })
      })
      watcher.on("unlink", (file) => {
        Bus.publish(Event.Updated, { file, event: "unlink" })
      })
      watcher.on("ready", () => {
        log.info("ready")
      })
      return { watcher }
    },
    async (state) => {
      state.watcher?.close()
    },
  )

  export function init() {
    if (!Flag.OPENCODE_EXPERIMENTAL_WATCHER) return
    state()
  }
}
