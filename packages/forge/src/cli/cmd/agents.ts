import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { getAllAgents } from "../../acp/agents"
import { EOL } from "os"

async function checkAgentInstalled(agent: ReturnType<typeof getAllAgents>[0]): Promise<boolean> {
  // Skip agents are not installable
  if (agent.installMethod === "skip") {
    return false
  }

  // Check npx agents by trying to run with --help flag
  if (agent.installMethod === "npx") {
    try {
      // Try to check if the package is available by running with --help
      // Use the first arg as the package name
      const packageName = agent.acpStartupArgs[0]
      if (!packageName) return false

      const process = Bun.spawn(["npx", "--yes", packageName, "--help"], {
        stderr: "pipe",
        stdout: "pipe",
      })

      // Set up timeout
      const timeout = setTimeout(() => {
        process.kill()
      }, 5000)

      try {
        await process.exited
        clearTimeout(timeout)

        // If exit code is 0, it's available
        if (process.exitCode === 0) {
          return true
        }

        // Check stderr for package resolution errors
        const stderr = await new Response(process.stderr).text()
        // If it says the package can't be found or resolved, it's not available
        if (stderr.includes("not found") || stderr.includes("Cannot find") || stderr.includes("npm ERR")) {
          return false
        }

        // Other errors might mean the package exists but --help failed, which is okay
        // We'll be conservative and say it's not available if exit code != 0
        return false
      } catch {
        clearTimeout(timeout)
        return false
      }
    } catch {
      return false
    }
  }

  // Check uvx agents by trying to run with --help flag
  // If the package exists, it will either show help or fail with a specific error
  // If it doesn't exist at all, uvx will fail to resolve it
  if (agent.installMethod === "uvx") {
    try {
      // Try running with --help to see if the package is available
      // Some packages might not support --help, so we also check stderr for resolution errors
      const checkArgs = [...agent.acpStartupArgs, "--help"]
      const process = Bun.spawn([agent.command, ...checkArgs], {
        stderr: "pipe",
        stdout: "pipe",
      })

      // Set up timeout
      const timeout = setTimeout(() => {
        process.kill()
      }, 5000)

      try {
        await process.exited
        clearTimeout(timeout)

        // If exit code is 0, it's available
        if (process.exitCode === 0) {
          return true
        }

        // Check stderr for package resolution errors
        const stderr = await new Response(process.stderr).text()
        // If it says the executable/package is not found, it's not installed
        if (stderr.includes("not found") || stderr.includes("not provided")) {
          return false
        }

        // Other errors might mean the package exists but --help failed, which is okay
        // We'll be conservative and say it's not available if exit code != 0
        return false
      } catch {
        clearTimeout(timeout)
        return false
      }
    } catch {
      return false
    }
  }

  // Check system agents using their installCheck command
  if (agent.installMethod === "system" && agent.installCheck) {
    try {
      const process = Bun.spawn(["sh", "-c", agent.installCheck], {
        stderr: "pipe",
        stdout: "pipe",
      })

      // Set up timeout
      const timeout = setTimeout(() => {
        process.kill()
      }, 5000)

      try {
        await process.exited
        clearTimeout(timeout)
        return process.exitCode === 0
      } catch {
        clearTimeout(timeout)
        return false
      }
    } catch {
      return false
    }
  }

  return false
}

export const AgentsCommand = cmd({
  command: "agents",
  describe: "list all available ACP agents",
  builder: (yargs: Argv) => {
    return yargs.option("check", {
      alias: "c",
      type: "boolean",
      describe: "check which agents are installed on the system",
      default: false,
    })
  },
  handler: async (argv) => {
    const agents = getAllAgents()
    const checkInstalled = argv.check as boolean

    if (checkInstalled) {
      process.stdout.write(`${EOL}Checking agents...${EOL}${EOL}`)

      // Track results as they come in
      const installed: Array<{ agent: ReturnType<typeof getAllAgents>[0] }> = []
      const notInstalled: Array<{ agent: ReturnType<typeof getAllAgents>[0] }> = []

      // Start all checks in parallel and display results as they complete
      const checkPromises = agents.map(async (agent) => {
        const installed = await checkAgentInstalled(agent)
        return { agent, installed }
      })

      // Process results as they complete
      for (const promise of checkPromises) {
        const result = await promise
        if (result.installed) {
          installed.push({ agent: result.agent })
          process.stdout.write(`✓ ${result.agent.name}${EOL}`)
        } else {
          notInstalled.push({ agent: result.agent })
          process.stdout.write(`✗ ${result.agent.name}${EOL}`)
        }
      }

      // Display summary
      process.stdout.write(`${EOL}Summary:${EOL}`)
      process.stdout.write(`  ✓ Installed: ${installed.length}${EOL}`)
      process.stdout.write(`  ✗ Not Installed: ${notInstalled.length}${EOL}`)
      process.stdout.write(EOL)
    } else {
      // Simple list mode (original behavior)
      for (const agent of agents) {
        process.stdout.write(agent.name)
        process.stdout.write(EOL)
      }
    }
  },
})
