import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

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
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
      .option("major", {
        describe: "upgrade to OpenCode 2 and remove OpenCode 1",
        type: "boolean",
      })
  },
  handler: async (args: { target?: string; method?: string; major?: boolean }) => {
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

    if (args.major) {
      prompts.log.info(`From ${InstallationVersion} → OpenCode 2`)
      const spinner = prompts.spinner()
      spinner.start("Installing OpenCode 2...")
      const err = await Installation.upgradeMajor(method).catch((err) => err)
      if (err) {
        spinner.stop("Upgrade failed", 1)
        if (err instanceof Error) prompts.log.error(err.message)
        prompts.log.info(`To install OpenCode 2 manually, see ${Installation.MAJOR_INSTRUCTIONS}`)
        prompts.outro("Done")
        return
      }
      spinner.stop("OpenCode 2 installed")
      prompts.outro("Done")
      return
    }

    const target = args.target ? args.target.replace(/^v/, "") : await Installation.latest()

    if (InstallationVersion === target) {
      prompts.log.warn(`opencode upgrade skipped: ${target} is already installed`)
      prompts.log.info("OpenCode 2 is available. Upgrade with `opencode upgrade --major`")
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${InstallationVersion} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) {
        // necessary because choco only allows install/upgrade in elevated terminals
        if (method === "choco" && err.stderr.includes("not running from an elevated command shell")) {
          prompts.log.error("Please run the terminal as Administrator and try again")
        } else {
          prompts.log.error(err.stderr)
        }
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.log.info("OpenCode 2 is available. Upgrade with `opencode upgrade --major`")
    prompts.outro("Done")
  },
}
