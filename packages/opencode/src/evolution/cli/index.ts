import { cmd } from "@/cli/cmd/cmd"
import { StatusCommand } from "./status"

export const EvolutionCommand = cmd({
  command: "evolution",
  describe: "Evolution Layer — AI project memory, planning, and review",
  builder: (yargs) =>
    yargs
      .command(StatusCommand)
      .demandCommand(1, "Please specify a subcommand: status"),
  async handler() {},
})

export * as EvolutionCli from "."
