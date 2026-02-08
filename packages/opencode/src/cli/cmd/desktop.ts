import { cmd } from "./cmd"
import { UI } from "../ui"
import path from "path"
import { spawn } from "child_process"

const APP_PATHS = {
  darwin: ["/Applications/OpenCode.app", `${process.env.HOME}/Applications/OpenCode.app`],
  win32: [`${process.env.LOCALAPPDATA}\\OpenCode\\OpenCode.exe`, `${process.env.PROGRAMFILES}\\OpenCode\\OpenCode.exe`],
  linux: ["/usr/bin/opencode-desktop", "/opt/OpenCode/opencode-desktop"],
}

function findApp(): string | null {
  const platform = process.platform as keyof typeof APP_PATHS
  const paths = APP_PATHS[platform] ?? []

  for (const p of paths) {
    if (Bun.file(p).size > 0) return p
  }
  return null
}

function openDesktopApp(appPath: string, directory: string) {
  const platform = process.platform

  if (platform === "darwin") {
    spawn("open", ["-a", appPath, directory], { detached: true, stdio: "ignore" }).unref()
  } else if (platform === "win32") {
    spawn(appPath, [directory], { detached: true, stdio: "ignore", shell: true }).unref()
  } else {
    spawn(appPath, [directory], { detached: true, stdio: "ignore" }).unref()
  }
}

export const DesktopCommand = cmd({
  command: "desktop [directory]",
  describe: "open OpenCode desktop app with specified directory",
  builder: (yargs) =>
    yargs.positional("directory", {
      type: "string",
      describe: "directory to open (defaults to current directory)",
      default: ".",
    }),
  handler: async (args) => {
    const appPath = findApp()
    if (!appPath) {
      UI.error("OpenCode desktop app not found. Please install it first.")
      UI.println("  macOS: brew install --cask opencode-desktop")
      UI.println("  Or download from: https://opencode.ai/download")
      process.exit(1)
    }

    const directory = path.resolve(args.directory)
    const stat = await Bun.file(directory)
      .stat()
      .catch(() => null)

    if (!stat?.isDirectory()) {
      UI.error(`Not a directory: ${directory}`)
      process.exit(1)
    }

    openDesktopApp(appPath, directory)
  },
})
