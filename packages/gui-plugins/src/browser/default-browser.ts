import { execFile, spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import electron from "electron"

/** Resolve the HTTPS application before checking the preview file. Never invoke the file's association. */
export async function defaultBrowser() {
  const platform = process.platform

  const app = platform === "linux" ? await desktopEntry() :
    (await electron.app.getApplicationInfoForProtocol("https://example.invalid")).path

  return async (file: string) => {
    const command = browserCommand(platform, app, pathToFileURL(file).href)

    if (!command) throw new Error("browser.menu.failed")

    if (platform !== "win32") {
      await promisify(execFile)(command.file, command.args, { timeout: 10_000 })

      return
    }

    // A newly started browser may live for hours. Completion is process creation, not its eventual exit.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.file, command.args, { shell: false, detached: true, stdio: "ignore" })
      child.once("error", reject)
      child.once("spawn", () => { child.unref(); resolve() })
    })
  }
}

export function browserCommand(platform: NodeJS.Platform, app: string, url: string) {
  if (platform === "win32" && /^[a-z]:[\\/]/i.test(app) && /\.exe$/i.test(app)) return { file: app, args: [url] }

  if (platform === "darwin" && path.posix.isAbsolute(app) && app.endsWith(".app")) return { file: "/usr/bin/open", args: ["-a", app, url] }

  if (platform === "linux" && path.posix.isAbsolute(app) && app.endsWith(".desktop")) return { file: "/usr/bin/gio", args: ["launch", app, url] }
}

async function desktopEntry() {
  const result = await promisify(execFile)("/usr/bin/xdg-mime", ["query", "default", "x-scheme-handler/https"], { timeout: 5_000, maxBuffer: 4096 })
  const id = result.stdout.trim()

  if (!/^[a-z0-9_][a-z0-9._-]*\.desktop$/i.test(id)) throw new Error("browser.menu.failed")
  const home = process.env.XDG_DATA_HOME || path.join(homedir(), ".local/share")
  const dirs = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":")

  for (const root of [home, ...dirs].filter(dir => path.posix.isAbsolute(dir))) {
    const file = path.join(root, "applications", id)

    if (await stat(file).then(info => info.isFile(), () => false)) return file
  }

  throw new Error("browser.menu.failed")
}
