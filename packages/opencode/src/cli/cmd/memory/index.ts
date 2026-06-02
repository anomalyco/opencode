import { cmd } from "../cmd"
import { MemoryListCommand } from "./list"
import { MemoryShowCommand } from "./show"
import { MemoryPruneCommand } from "./prune"
import { MemorySearchCommand } from "./search"

export const MemoryCommand = cmd({
  command: "memory",
  describe: "self-improvement memory management",
  builder: (yargs) =>
    yargs
      .command(MemoryListCommand)
      .command(MemoryShowCommand)
      .command(MemoryPruneCommand)
      .command(MemorySearchCommand)
      .demandCommand(),
  async handler() {},
})

export * as Memory from "."
