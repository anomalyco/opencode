import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import { matchAgent } from "../../acp/agents"

export const CheckCommand = cmd({
  command: "check [agent]",
  describe: "check if an ACP agent is installed",
  builder: (yargs: Argv) => {
    return yargs.positional("agent", {
      describe: "agent name to check",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    const agentName = args.agent as string

    // Find the agent
    const agentMatch = matchAgent(agentName)
    if (!agentMatch.success) {
      if (agentMatch.error === "not-found") {
        UI.error(`Agent not found: ${agentName}${EOL}`)
        UI.error(`Available agents: ${agentMatch.available.map((a) => a.name).join(", ")}${EOL}`)
        process.exit(1)
      } else if (agentMatch.error === "ambiguous") {
        UI.error(`Ambiguous agent name: ${agentName}${EOL}`)
        UI.error(`Did you mean one of: ${agentMatch.matches.map((a) => a.name).join(", ")}?${EOL}`)
        process.exit(1)
      }
      return
    }

    const agent = agentMatch.match

    // Check if agent is installed using Bun.which
    const isInstalled = Bun.which(agent.command) !== null

    if (isInstalled) {
      process.stdout.write(`✓ ${agent.name} is installed${EOL}`)
      process.exit(0)
    } else {
      process.stdout.write(`✗ ${agent.name} is not installed${EOL}`)
      process.stdout.write(`  Run 'forge install "${agent.name}"' to install${EOL}`)
      process.exit(1)
    }
  },
})
