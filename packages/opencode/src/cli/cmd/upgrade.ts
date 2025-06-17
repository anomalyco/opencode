import type { Argv } from "yargs"
import { UI } from "../ui"
import { VERSION } from "../version"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "Upgrade opencode to the latest version or a specific version",
  builder: (yargs: Argv) => {
    return yargs.positional("target", {
      describe: "Specific version to upgrade to (e.g., '0.1.48' or 'v0.1.48')",
      type: "string",
    })
  },
  handler: async (args: { target?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const method = await Installation.method()
    if (method === "unknown") {
      prompts.log.error(
        `opencode is installed to ${process.execPath} and seems to be managed by a package manager`,
      )
      prompts.outro("Done")
      return
    }
    const target = args.target ?? (await Installation.latest())
    prompts.log.info(`From ${VERSION} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      spinner.stop("Upgrade failed")
      if (err instanceof Installation.UpgradeFailedError)
        prompts.log.error(err.data.stderr)
      else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
    return

    /*
    if (!process.execPath.includes(path.join(".opencode", "bin")) && false) {
      return
    }

    const release = args.target
      ? await specific(args.target).catch(() => {})
      : await latest().catch(() => {})
    if (!release) {
      prompts.log.error("Failed to fetch release information")
      prompts.outro("Done")
      return
    }

    const target = release.tag_name

    if (VERSION !== "dev" && compare(VERSION, target) >= 0) {
      prompts.log.success(`Already up to date`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${VERSION} → ${target}`)

    const name = asset()
    const found = release.assets.find((a) => a.name === name)

    if (!found) {
      prompts.log.error(`No binary found for platform: ${name}`)
      prompts.outro("Done")
      return
    }

    const spinner = prompts.spinner()
    spinner.start("Downloading update...")

    const downloadPath = await download(found.browser_download_url).catch(
      () => {},
    )
    if (!downloadPath) {
      spinner.stop("Download failed")
      prompts.log.error("Download failed")
      prompts.outro("Done")
      return
    }

    spinner.stop("Download complete")

    const renamed = await fs
      .rename(downloadPath, process.execPath)
      .catch(() => {})

    if (renamed === undefined) {
      prompts.log.error("Install failed")
      await fs.unlink(downloadPath).catch(() => {})
      prompts.outro("Done")
      return
    }

    prompts.log.success(`Successfully upgraded to ${target}`)
    prompts.outro("Done")
    */
  },
}
