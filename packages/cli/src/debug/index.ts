import * as Command from "effect/unstable/cli/Command"
import { AgentsCommand } from "./agents"

export const DebugCommand = Command.make("debug").pipe(
  Command.withDescription("Debugging and troubleshooting tools"),
  Command.withSubcommands([AgentsCommand]),
)
