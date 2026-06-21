import { cmd } from "@/cli/cmd/cmd"
import { StatusCommand } from "./status"
import { EvaluateCommand } from "./evaluate"
import { MetricsCommand } from "./metrics"
import { AnalyzeCommand } from "./analyze"
import { ImproveCommand } from "./improve"
import { RetentionStatusCommand } from "./retention-status"
import { MemoryCommand } from "./memory"

export const EvolutionCommand = cmd({
  command: "evolution",
  describe: "Evolution Layer — AI project memory, planning, and review",
  builder: (yargs) =>
    yargs
      .command(StatusCommand)
      .command(EvaluateCommand)
      .command(MetricsCommand)
      .command(AnalyzeCommand)
      .command(ImproveCommand)
      .command(RetentionStatusCommand)
      .command(MemoryCommand)
      .demandCommand(1, "Please specify a subcommand: status"),
  async handler() {},
})

export * as EvolutionCli from "."
