import { EOL } from "os"
import { basename } from "path"
import { Agent } from "../../../agent/agent"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const AgentCommand = cmd({
  command: "agent <name>",
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
      description: "Agent name",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const agentName = args.name as string
      const agent = await Agent.get(agentName)
      if (!agent) {
        process.stderr.write(
          `Agent ${agentName} not found, run '${basename(process.execPath)} agent list' to get an agent list` + EOL,
        )
        process.exit(1)
      }
      process.stdout.write(JSON.stringify(agent, null, 2) + EOL)
    })
  },
})
