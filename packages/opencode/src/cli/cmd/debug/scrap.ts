import { EOL } from "os"
import { cmd } from "../cmd"

export const ScrapCommand = cmd({
  command: "scrap",
  describe: "list all known projects",
  builder: (yargs) => yargs,
  async handler() {
    const { Project } = await import("@/project/project")
    const { makeRuntime } = await import("@opencode-ai/core/effect/runtime")
    const runtime = makeRuntime(Project.Service, Project.defaultLayer)
    const list = await runtime.runPromise((project) => project.list())
    process.stdout.write(JSON.stringify(list, null, 2) + EOL)
  },
})
