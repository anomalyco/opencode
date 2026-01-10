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

    if (method === "brew") {
      const formula = await Installation.getBrewFormula()
      const commands = Installation.getMigrationCommands(formula)

      if (commands) {
        const reason =
          formula === "sst/tap/opencode"
            ? "You have the old sst/tap formula installed. The tap has been renamed to anomalyco/tap."
            : "You are on the homebrew core formula, which updates every ~10 versions.\nThe anomalyco/tap formula updates on every release."

        prompts.log.warn(`${reason}\n\nTo migrate: ${commands.join(" && ")}`)

        const migrate = await prompts.confirm({
          message: "Would you like to migrate to the anomalyco/tap? (You can run these commands manually later)",
          initialValue: true,
        })
        if (migrate) {
          for (const cmd of commands) {
            const migrationSpinner = prompts.spinner()
            migrationSpinner.start(cmd)
            try {
              await Installation.executeMigration([cmd])
              migrationSpinner.stop(cmd)
            } catch (err) {
              migrationSpinner.stop(`Failed: ${cmd}`, 1)
              if (err instanceof Error) prompts.log.error(err.message)
              prompts.outro("Done")
              return
            }
          }
        }
      }
    }

    const target = args.target ? args.target.replace(/^v/, "") : await Installation.latest()

    if (Installation.VERSION === target) {
      prompts.log.warn(`opencode upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${Installation.VERSION} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) prompts.log.error(err.data.stderr)
      else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}
