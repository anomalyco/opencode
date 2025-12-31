import { EOL } from "os"
import { basename } from "path"
import { Agent } from "../../../agent/agent"
import { Provider } from "../../../provider/provider"
import { ToolRegistry } from "../../../tool/registry"
import { Wildcard } from "../../../util/wildcard"
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
      const resolvedTools = await resolveTools(agent)
      const output = {
        ...agent,
        tools: resolvedTools,
        toolOverrides: agent.tools,
      }
      process.stdout.write(JSON.stringify(output, null, 2) + EOL)
    })
  },
})

async function resolveTools(agent: Agent.Info) {
  const providerID = agent.model?.providerID ?? (await Provider.defaultModel()).providerID
  const toolOverrides = {
    ...agent.tools,
    ...(await ToolRegistry.enabled(agent)),
  }
  const availableTools = await ToolRegistry.tools(providerID, agent)
  const resolved: Record<string, boolean> = {}
  for (const tool of availableTools) {
    resolved[tool.id] = Wildcard.all(tool.id, toolOverrides) !== false
  }
  return resolved
}
