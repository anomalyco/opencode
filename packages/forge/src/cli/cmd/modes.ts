import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import { matchAgent } from "../../acp/agents"
import { ACPClient } from "../../acp/client"
import { AuthenticationRequiredError } from "../../acp/types"

export const ModesCommand = cmd({
  command: "modes [agent]",
  describe: "list available modes for an ACP agent",
  builder: (yargs: Argv) => {
    return yargs
      .positional("agent", {
        describe: "agent name to list modes for",
        type: "string",
        demandOption: true,
      })
      .option("verbose", {
        describe: "use more verbose mode output (includes mode names)",
        type: "boolean",
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

    let client: ACPClient.Instance | undefined
    try {
      // Create ACP client
      client = await ACPClient.create({
        command: agent.command,
        args: agent.acpStartupArgs,
        cwd: process.cwd(),
      })

      // Initialize
      await client.initialize()

      // Create session
      try {
        await client.createSession()
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) {
          // Try to authenticate with first available method
          if (error.authMethods.length === 0) {
            UI.error(`Agent ${agent.name} requires authentication but provided no auth methods${EOL}`)
            process.exit(1)
          }

          const authMethod = error.authMethods[0]

          // Check for terminal auth
          if (authMethod._meta?.["terminal-auth"]) {
            const terminalAuth = authMethod._meta["terminal-auth"] as {
              command?: string
              args?: string[]
              label?: string
            }
            UI.error(
              `Authentication required: Please run '${terminalAuth.command} ${(terminalAuth.args ?? []).join(" ")}' in your terminal${EOL}`,
            )
            process.exit(1)
          }

          await client.authenticate(authMethod.id)
          await client.createSession()
        } else {
          throw error
        }
      }

      // Get modes
      const modes = client.getModes()
      if (!modes || !modes.availableModes || modes.availableModes.length === 0) {
        UI.error(`No modes available for agent ${agent.name}${EOL}`)
        process.exit(1)
      }

      // Display modes
      for (const mode of modes.availableModes) {
        if (args.verbose) {
          // Verbose: show both id and name
          process.stdout.write(`${mode.id}`)
          if (mode.name && mode.name !== mode.id) {
            process.stdout.write(` (${mode.name})`)
          }
          process.stdout.write(EOL)
        } else {
          // Simple: just show the mode ID (what users need for --agent flag)
          process.stdout.write(mode.id)
          process.stdout.write(EOL)
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      UI.error(`Failed to get modes for agent ${agent.name}: ${err.message}${EOL}`)
      if (agent.installGuide) {
        UI.error(`See installation guide: ${agent.installGuide}${EOL}`)
      }
      process.exit(1)
    } finally {
      // Clean up
      if (client) {
        await client.dispose()
      }
    }
  },
})
