import z from "zod"
import { Bus } from "../bus"
import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"

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

  const watcher = lazy(() => {
    const binding = require(
      `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? "-glibc" : ""}`,
    )
    return createWrapper(binding) as typeof import("@parcel/watcher")
  })

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") return {}
      log.info("init")
      const cfg = await Config.get()
      const backend = (() => {
        if (process.platform === "win32") return "windows"
        if (process.platform === "darwin") return "fs-events"
        if (process.platform === "linux") return "inotify"
      })()
      if (!backend) {
        log.error("watcher backend not supported", { platform: process.platform })
        return {}
      }
      log.info("watcher backend", { platform: process.platform, backend })
      const sub = await watcher().subscribe(
        Instance.directory,
        (err, evts) => {
          if (err) return
          for (const evt of evts) {
            log.info("event", evt)
            if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
            if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
            if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
          }
        },
        {
          ignore: [...FileIgnore.PATTERNS, ...(cfg.watcher?.ignore ?? [])],
          backend,
        },
      )
      return { sub }
    },
    async (state) => {
      if (!state.sub) return
      await state.sub?.unsubscribe()
    },
  )

  export function init() {
    if (!Flag.OPENCODE_EXPERIMENTAL_WATCHER) return
    state()
  }
}
