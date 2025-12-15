import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { getAllAgents } from "../../acp/agents"
import { EOL } from "os"

export const AgentsCommand = cmd({
  command: "agents",
  describe: "list all available ACP agents",
  builder: (yargs: Argv) => {
    return yargs
  },
  handler: async (argv) => {
    const agents = getAllAgents()

    // List all agents
    for (const agent of agents) {
      process.stdout.write(agent.name)
      process.stdout.write(EOL)
    }
  },
})
