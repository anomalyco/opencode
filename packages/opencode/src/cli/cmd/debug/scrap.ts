import { cmd } from "../cmd"

export const ScrapCommand = cmd({
  command: "scrap",
  describe: "scrap debugging utilities",
  builder: (yargs) => yargs,
  async handler() {},
})
