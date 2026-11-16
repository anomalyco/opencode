import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const uninstallKey = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{6ED48C92-5177-41F4-B8D6-37B7B02CFDF4}_is1`

export function hexPaths(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv) {
  if (platform === "win32") {
    const roaming = env.APPDATA || path.win32.join(home, "AppData/Roaming")

    return {
      support: path.win32.join(roaming, "hex"),
      registry: path.win32.join(env.SystemRoot || "C:\\Windows", "System32/reg.exe"),
    }
  }

  if (platform === "darwin") {
    return {
      support: path.posix.join(home, "Library/Application Support/hex"),
      bundles: ["/Applications/Hex.app", path.posix.join(home, "Applications/Hex.app")],
    }
  }

  const data =
    env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.posix.join(home, ".local/share")

  const support = path.posix.join(data, "hex")

  if (platform !== "linux") return { support }

  const absoluteDirs = (list: string) => list.split(":").filter((dir) => path.posix.isAbsolute(dir))
  const dirs = new Set([data, ...absoluteDirs(env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")])
  const bins = new Set([path.posix.join(home, ".local/bin"), ...absoluteDirs(env.PATH ?? "")])

  return {
    support,
    entries: [...dirs].flatMap((dir) =>
      ["anomaly.hex.desktop", "hex.desktop"].map((name) => path.posix.join(dir, "applications", name)),
    ),
    binaries: [...bins].map((dir) => path.posix.join(dir, "hex")),
  }
}

const metadata = (file: string) => stat(file).catch(() => undefined)

export async function detectHex(paths: ReturnType<typeof hexPaths>) {
  if (await metadata(path.join(paths.support, "local-api.json"))) return true

  if (paths.registry) {
    const version = await readFile(path.join(paths.support, "current-version"), "utf8").then(
      (text) => text.trim(),
      () => undefined,
    )

    if (version && (await metadata(path.join(paths.support, "versions", version, "hex.exe")))?.isFile()) return true

    return promisify(execFile)(paths.registry, ["query", uninstallKey], { windowsHide: true, timeout: 1000 }).then(
      () => true,
      () => false,
    )
  }

  for (const bundle of paths.bundles ?? []) {
    if ((await metadata(bundle))?.isDirectory()) return true
  }

  for (const entry of paths.entries ?? []) {
    if ((await metadata(entry))?.isFile()) return true
  }

  for (const binary of paths.binaries ?? []) {
    const info = await metadata(binary)

    if (info?.isFile() && (info.mode & 0o111) !== 0) return true
  }

  return false
}
