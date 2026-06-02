import { cmd } from "../cmd"
import { BrowserListCommand } from "./list"
import { BrowserCloseCommand } from "./close"

export const BrowserCommand = cmd({
  command: "browser",
  describe: "browser tool management",
  builder: (yargs) =>
    yargs
      .command(BrowserListCommand)
      .command(BrowserCloseCommand)
      .demandCommand(),
  async handler() {},
})
