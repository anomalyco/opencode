import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { upgrade } from "../upgrade"
import { getAllAgents, getInstallCommandsForPlatform, matchAgent } from "@/acp/agents"
import { runAgentInstall } from "@/acp/install"

export const InstallAgentCommand = cmd({
  command: "install [agent]",
  describe: "install an ACP agent from the CLI",
  builder: (yargs: Argv) =>
    yargs.positional("agent", {
      type: "string",
      describe: "agent name to install",
    }),
  handler: async (args) => {
    await upgrade()

    const pickAgent = async (): Promise<string> => {
      if (args.agent) {
        const result = matchAgent(String(args.agent))
        if (result.success) return result.match.name
        UI.error(`Agent '${args.agent}' not found.`)
      }

      const options = getAllAgents().map((agent) => ({
        value: agent.name,
        label: agent.name,
        hint: agent.description,
      }))

      const selected = await prompts.select({
        message: "Select an agent to install",
        options,
      })

      if (!selected || prompts.isCancel(selected)) {
        throw new UI.CancelledError()
      }

      return selected as string
    }

    const agentName = await pickAgent()
    const agent = getAllAgents().find((a) => a.name === agentName)
    if (!agent) {
      UI.error(`Agent '${agentName}' not found.`)
      process.exit(1)
    }

    const commands = getInstallCommandsForPlatform(agent)
    if (!commands.length) {
      UI.error("No install commands available for this platform.")
      process.exit(1)
    }

    prompts.intro(`Install ${agent.name}`)

    const method = await prompts.select({
      message: "Select an install method",
      options: commands.map((cmd, idx) => ({
        value: idx,
        label: cmd.description ? `${cmd.method} — ${cmd.description}` : cmd.method,
        hint: cmd.command,
      })),
    })

    if (prompts.isCancel(method) || method === undefined || method === null) {
      throw new UI.CancelledError()
    }

    const selectedCommand = commands[method as number]

    prompts.log.info(selectedCommand.command)

    const result = await runAgentInstall({
      agent,
      installCommand: selectedCommand,
      onOutput: (chunk) => {
        process.stdout.write(chunk)
      },
    })

    if (result.code === 0 && result.detected) {
      prompts.outro(`${agent.name} installed and detected on PATH.`)
      return
    }

    const reason = result.error?.message ?? `Exit code ${result.code ?? "unknown"}`
    const detectedText = result.detected ? "Detected on PATH" : "Not detected on PATH"

    prompts.log.error(`${agent.name} install failed. ${detectedText}. ${reason}`)
    process.exit(1)
  },
})
