import type { Argv } from "yargs"
import { UI } from "../ui"
import { VERSION } from "../version"
import path from "path"
import fs from "fs/promises"
import os from "os"
import * as prompts from "@clack/prompts"
import { Global } from "../../global"
import { Upgrade } from "../../upgrade"

const API = "https://api.github.com/repos/sst/opencode"

interface Release {
  tag_name: string
  name: string
  assets: Array<{
    name: string
    browser_download_url: string
  }>
}

function asset(): string {
  const platform = os.platform()
  const arch = os.arch()

  if (platform === "darwin") {
    return arch === "arm64"
      ? "opencode-darwin-arm64.zip"
      : "opencode-darwin-x64.zip"
  }
  if (platform === "linux") {
    return arch === "arm64"
      ? "opencode-linux-arm64.zip"
      : "opencode-linux-x64.zip"
  }
  if (platform === "win32") {
    return "opencode-windows-x64.zip"
  }

  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

function compare(current: string, latest: string): number {
  const a = current.replace(/^v/, "")
  const b = latest.replace(/^v/, "")

  const aParts = a.split(".").map(Number)
  const bParts = b.split(".").map(Number)

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0
    const bPart = bParts[i] || 0

    if (aPart < bPart) return -1
    if (aPart > bPart) return 1
  }

  return 0
}

async function latest(): Promise<Release> {
  const response = await fetch(`${API}/releases/latest`)
  if (!response.ok) {
    throw new Error(`Failed to fetch latest release: ${response.statusText}`)
  }
  return response.json()
}

async function specific(version: string): Promise<Release> {
  const tag = version.startsWith("v") ? version : `v${version}`
  const response = await fetch(`${API}/releases/tags/${tag}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch release ${tag}: ${response.statusText}`)
  }
  return response.json()
}

async function download(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  const temp = path.join(Global.Path.cache, `opencode-update-${Date.now()}.zip`)

  await Bun.write(temp, buffer)

  const extractDir = path.join(
    Global.Path.cache,
    `opencode-extract-${Date.now()}`,
  )
  await fs.mkdir(extractDir, { recursive: true })

  const proc = Bun.spawn(["unzip", "-o", temp, "-d", extractDir], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const result = await proc.exited
  if (result !== 0) {
    throw new Error("Failed to extract update")
  }

  await fs.unlink(temp)

  const binary = path.join(extractDir, "opencode")
  await fs.chmod(binary, 0o755)

  return binary
}

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
    console.log(await Upgrade.method())
    return

    if (!process.execPath.includes(path.join(".opencode", "bin")) && false) {
      prompts.log.error(
        `opencode is installed to ${process.execPath} and seems to be managed by a package manager`,
      )
      prompts.outro("Done")
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
  },
}
