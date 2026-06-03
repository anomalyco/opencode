import { EOL } from "os"
import * as Log from "@opencode-ai/core/util/log"
import { cmd } from "../cmd"

export const ScrapCommand = cmd({
  command: "scrap",
  describe: "list all known projects",
  builder: (yargs) => yargs,
  async handler() {
    const { Project } = await import("@/project/project")
    const { makeRuntime } = await import("@opencode-ai/core/effect/runtime")
    const runtime = makeRuntime(Project.Service, Project.defaultLayer)
    const timer = Log.Default.time("scrap")
    const list = await runtime.runPromise((project) => project.list())
    process.stdout.write(JSON.stringify(list, null, 2) + EOL)
    timer.stop()
  },
})
