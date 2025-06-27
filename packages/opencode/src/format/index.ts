import { App } from "../app/app"
import { Bus } from "../bus"
import { File } from "../file"
import { Log } from "../util/log"
import path from "path"

import type { Definition } from "./definition"
import {readdir} from "fs/promises";

export namespace Format {
  const log = Log.create({ service: "format" })

  const state = App.state("format", () => {
    const enabled: Record<string, boolean> = {}

    return {
      enabled,
    }
  })

  async function isEnabled(item: Definition) {
    const s = state()
    let status = s.enabled[item.name]
    if (status === undefined) {
      status = await item.enabled()
      s.enabled[item.name] = status
    }
    return status
  }

  async function getFormatter(ext: string) {
    const result = []
    for (const item of FORMATTERS) {
      if (!item.extensions.includes(ext)) continue
      if (!isEnabled(item)) continue
      result.push(item)
    }
    return result
  }

  export function init() {
    log.info("init")
    Bus.subscribe(File.Event.Edited, async (payload) => {
      const file = payload.properties.file
      log.info("formatting", { file })
      const ext = path.extname(file)

      for (const item of await getFormatter(ext)) {
        log.info("running", { command: item.command })
        const proc = Bun.spawn({
          cmd: item.command.map((x) => x.replace("$FILE", file)),
          cwd: App.info().path.cwd,
          env: item.environment,
          stdout: "ignore",
          stderr: "ignore",
        })
        const exit = await proc.exited
        if (exit !== 0)
          log.error("failed", {
            command: item.command,
            ...item.environment,
          })
      }
    })
  }


  const FORMATTERS: Definition[] = []
  const formattersPath = path.join(__dirname, "formatters")
  async function loadFormatters() {
      const files = await readdir(formattersPath, { withFileTypes: true })
      for (const file of files) {
          const modulePath = path.join(formattersPath, file.name)
            if (file.isFile() && file.name.endsWith(".ts")) {
                const module = await import(modulePath)
                if (module && module.default) {
                    const formatter: Definition = module.default
                    FORMATTERS.push(formatter)
                } else {
                    log.warn("No default export found in formatter module", { modulePath })
                }
            }
      }

  }
  loadFormatters().catch((err) => {
      log.error("Failed to load formatters", { error: err })
  })
}
