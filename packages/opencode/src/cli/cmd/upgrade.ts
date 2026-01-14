import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade opencode to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const detectedMethod = await Installation.method()
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`opencode is installed to ${process.execPath} and may be managed by a package manager`)
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info("Using method: " + method)
    const target = args.target ? args.target.replace(/^v/, "") : await Installation.latest()

    if (Installation.VERSION === target) {
      prompts.log.warn(`opencode upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    // Validate version exists before attempting upgrade
    if (args.target) {
      const spinner = prompts.spinner()
      spinner.start("Checking version availability...")
      const exists = await Installation.versionExists(target, method)
      if (!exists) {
        spinner.stop("Version not found", 1)
        if (method === "brew") {
          prompts.log.error(`Version ${target} is not available via brew. Only the latest version can be installed.`)
          const latestVersion = await Installation.latest(method).catch(() => null)
          if (latestVersion) {
            prompts.log.info(`Available version: ${latestVersion}`)
          }
        } else {
          prompts.log.error(`Version ${target} was not found. Please check the version number and try again.`)
        }
        prompts.outro("Done")
        return
      }
      spinner.stop("Version available")
    }

    prompts.log.info(`From ${Installation.VERSION} → ${target}`)
    const upgradeSpinner = prompts.spinner()
    upgradeSpinner.start("Upgrading...")
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      upgradeSpinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) prompts.log.error(err.data.stderr)
      else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    upgradeSpinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}
