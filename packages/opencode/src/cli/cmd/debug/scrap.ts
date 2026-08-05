import { EOL } from "os"
import { cmd } from "../cmd"

export const ScrapCommand = cmd({
  command: "scrap",
  describe: "list all known projects",
  builder: (yargs) => yargs,
  async handler() {
    const { Project } = await import("@/project/project")
    const { AppNodeBuilder } = await import("@opencode-ai/core/effect/app-node-builder")
    const { makeRuntime } = await import("@opencode-ai/core/effect/runtime")
    const runtime = makeRuntime(Project.Service, AppNodeBuilder.build(Project.node))
    const list = await runtime.runPromise((project) => project.list())
    process.stdout.write(JSON.stringify(list, null, 2) + EOL)
  },
})
