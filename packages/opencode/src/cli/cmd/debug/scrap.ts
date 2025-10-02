import { Project } from "../../../project/project"
import { Log } from "../../../util/log"
import { cmd } from "../cmd"

export const ScrapCommand = cmd({
  command: "scrap",
  builder: (yargs) => yargs,
  async handler() {
    const timer = Log.Default.time("scrap")
    const list = await Project.list()
    console.log(list)
    timer.stop()
  },
})
