import { cmd } from "../cmd"
import { CurationStatusCommand } from "./status"
import { CurationRunCommand } from "./run"

export const CurationCommand = cmd({
  command: "curation",
  describe: "self-improvement curation operations",
  builder: (yargs) =>
    yargs
      .command(CurationStatusCommand)
      .command(CurationRunCommand)
      .demandCommand(),
  async handler() {},
})

export * as Curation from "."