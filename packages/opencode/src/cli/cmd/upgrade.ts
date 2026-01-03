import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { t } from "../../i18n"

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
    prompts.intro(t("upgrade.title"))
    const detectedMethod = await Installation.method()
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(t("upgrade.installed_to", { path: process.execPath }))
      const install = await prompts.select({
        message: t("upgrade.install_anyway"),
        options: [
          { label: t("upgrade.yes"), value: true },
          { label: t("upgrade.no"), value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro(t("upgrade.done"))
        return
      }
    }
    prompts.log.info(t("upgrade.using_method", { method }))
    const target = args.target ? args.target.replace(/^v/, "") : await Installation.latest()

    if (Installation.VERSION === target) {
      prompts.log.warn(t("upgrade.skipped", { version: target }))
      prompts.outro(t("upgrade.done"))
      return
    }

    prompts.log.info(t("upgrade.from_to", { from: Installation.VERSION, to: target }))
    const spinner = prompts.spinner()
    spinner.start(t("upgrade.upgrading"))
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      spinner.stop(t("upgrade.failed"), 1)
      if (err instanceof Installation.UpgradeFailedError) prompts.log.error(err.data.stderr)
      else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro(t("upgrade.done"))
      return
    }
    spinner.stop(t("upgrade.complete"))
    prompts.outro(t("upgrade.done"))
  },
}
