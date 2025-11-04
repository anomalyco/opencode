import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { Global } from "../../global"
import fs from "fs/promises"
import { $ } from "bun"

async function cleanupPathEntries(installDir: string) {
  const home = process.env.HOME
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || `${home}/.config`

  const configFiles = [
    `${home}/.bashrc`,
    `${home}/.bash_profile`,
    `${home}/.profile`,
    `${home}/.zshrc`,
    `${home}/.zshenv`,
    `${home}/.config/fish/config.fish`,
    `${xdgConfigHome}/zsh/.zshrc`,
    `${xdgConfigHome}/zsh/.zshenv`,
    `${xdgConfigHome}/bash/.bashrc`,
    `${xdgConfigHome}/bash/.bash_profile`,
  ]

  for (const configFile of configFiles) {
    try {
      const content = await fs.readFile(configFile, "utf-8")

      // Remove lines that add opencode to PATH
      const lines = content.split("\n")
      const filteredLines = []
      let skipNext = false

      for (const line of lines) {
        // Skip comment line and the PATH export
        if (line.trim() === "# opencode") {
          skipNext = true
          continue
        }

        if (skipNext && (line.includes(installDir) || line.includes("fish_add_path"))) {
          skipNext = false
          continue
        }

        skipNext = false
        filteredLines.push(line)
      }

      if (filteredLines.length !== lines.length) {
        await fs.writeFile(configFile, filteredLines.join("\n"))
        prompts.log.success(`Cleaned up PATH entry from ${configFile}`)
      }
    } catch {
      // File doesn't exist or can't be read, skip
    }
  }
}

export const UninstallCommand = {
  command: "uninstall",
  describe: "uninstall opencode and clean up all related files",
  builder: (yargs: Argv) => {
    return yargs
      .option("keep-data", {
        describe: "keep user data (sessions, config, etc.)",
        type: "boolean",
        default: false,
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew"],
      })
  },
  handler: async (args: { keepData?: boolean; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Uninstall OpenCode")

    const confirm = await prompts.confirm({
      message: "Are you sure you want to uninstall OpenCode?",
      initialValue: false,
    })

    if (prompts.isCancel(confirm) || !confirm) {
      prompts.outro("Uninstall cancelled")
      return
    }

    const detectedMethod = await Installation.method()
    const method = (args.method as Installation.Method) ?? detectedMethod

    prompts.log.info("Installation method: " + method)

    // Uninstall via package manager
    const spinner = prompts.spinner()
    spinner.start("Uninstalling OpenCode binary...")

    try {
      let cmd
      switch (method) {
        case "curl":
          // For curl installs, binary is in $HOME/.opencode/bin
          const installDir = `${process.env.HOME}/.opencode/bin`
          const binFile = `${installDir}/opencode`

          try {
            await fs.access(binFile)
            await fs.unlink(binFile)
            prompts.log.success(`Removed binary from ${binFile}`)

            // Also try to clean up PATH entries from shell config files
            await cleanupPathEntries(installDir)
          } catch (error) {
            prompts.log.warn(
              `Could not find OpenCode binary at ${binFile}. It may have been removed already.`,
            )
          }
          break

        case "npm":
          cmd = $`npm uninstall -g opencode-ai`
          break

        case "pnpm":
          cmd = $`pnpm uninstall -g opencode-ai`
          break

        case "bun":
          cmd = $`bun remove -g opencode-ai`
          break

        case "brew": {
          // Check which formula is installed
          const tapFormula = await $`brew list --formula sst/tap/opencode`.throws(false).text()
          const formula = tapFormula.includes("opencode") ? "sst/tap/opencode" : "opencode"
          cmd = $`brew uninstall ${formula}`.env({
            HOMEBREW_NO_AUTO_UPDATE: "1",
          })
          break
        }

        case "unknown":
          prompts.log.warn(
            `Could not detect installation method. Binary location: ${process.execPath}`,
          )
          prompts.log.info("You may need to uninstall manually using your package manager.")
          break
      }

      if (cmd) {
        const result = await cmd.quiet().throws(false)
        if (result.exitCode !== 0) {
          spinner.stop("Failed to uninstall binary", 1)
          prompts.log.error(result.stderr.toString("utf8"))
        } else {
          spinner.stop("Binary uninstalled")
        }
      } else {
        spinner.stop("Binary removal completed")
      }
    } catch (error) {
      spinner.stop("Failed to uninstall binary", 1)
      if (error instanceof Error) {
        prompts.log.error(error.message)
      }
    }

    // Clean up data directories
    if (!args.keepData) {
      const cleanupSpinner = prompts.spinner()
      cleanupSpinner.start("Cleaning up OpenCode data...")

      const dirsToRemove = [
        { path: Global.Path.data, name: "data" },
        { path: Global.Path.cache, name: "cache" },
        { path: Global.Path.config, name: "config" },
        { path: Global.Path.state, name: "state" },
      ]

      for (const { path, name } of dirsToRemove) {
        try {
          await fs.rm(path, { recursive: true, force: true })
          prompts.log.success(`Removed ${name}: ${path}`)
        } catch (error) {
          prompts.log.warn(`Could not remove ${name} directory: ${path}`)
        }
      }

      cleanupSpinner.stop("Data cleanup complete")
    } else {
      prompts.log.info("User data preserved (use without --keep-data to remove)")
      prompts.log.info(`Data location: ${Global.Path.data}`)
      prompts.log.info(`Config location: ${Global.Path.config}`)
    }

    UI.empty()
    prompts.outro("OpenCode has been uninstalled")
    UI.println(
      UI.Style.TEXT_DIM +
        "Thank you for using OpenCode! Join our community:",
    )
    UI.println(
      UI.Style.TEXT_DIM +
        "  Discord: https://discord.gg/opencode",
    )
    UI.println(
      UI.Style.TEXT_DIM +
        "  GitHub: https://github.com/sst/opencode",
    )
  },
}
