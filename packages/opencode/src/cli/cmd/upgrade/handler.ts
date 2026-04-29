import { UI } from "../../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../../installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import type { UpgradeArgs } from "./command"

export async function handler(args: UpgradeArgs) {
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

  if (InstallationVersion === target) {
    prompts.log.warn(`opencode upgrade skipped: ${target} is already installed`)
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
  prompts.outro("Done")
}
