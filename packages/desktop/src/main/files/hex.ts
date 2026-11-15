import { stat } from "node:fs/promises"
import path from "node:path"

export function hexPaths(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv) {
  const paths = platform === "win32" ? path.win32 : path.posix
  const files = installedPaths(platform, home, env)
  const names = platform === "win32" ? ["hex.com", "hex.exe"] : ["hex"]
  const dirs = (env.PATH ?? "").split(paths.delimiter).filter((dir) => paths.isAbsolute(dir))

  return new Set([...files, ...dirs.flatMap((dir) => names.map((name) => paths.join(dir, name)))])
}

export async function detectHex(files: Iterable<string>) {
  for (const file of files) {
    const info = await stat(file).catch(() => undefined)

    if (!info) continue

    if (file.endsWith("/service.sock")) {
      if (info.isSocket()) return true
      continue
    }

    if (info.isFile() && (path.basename(file) !== "hex" || (info.mode & 0o111) !== 0)) return true
  }

  return false
}

function installedPaths(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv) {
  if (platform === "darwin") {
    const binary = "Applications/Hex.app/Contents/MacOS/hex"

    return [`/${binary}`, path.posix.join(home, binary)]
  }

  if (platform === "win32") {
    const roaming = env.APPDATA || path.win32.join(home, "AppData", "Roaming")

    return ["hex", "voice-control"].map((dir) => path.win32.join(roaming, dir, "current-version"))
  }

  if (platform !== "linux") return []

  const data = env.XDG_DATA_HOME || path.posix.join(home, ".local/share")
  const support = env.HEX_APPLICATION_SUPPORT_DIR || path.posix.join(data, "hex")

  return [
    "/usr/bin/hex",
    "/usr/share/applications/anomaly.hex.desktop",
    path.posix.join(data, "applications/anomaly.hex.desktop"),
    path.posix.join(env.HEX_INSTALL_DIR || path.posix.join(home, ".local/bin"), "hex"),
    path.posix.join(support, "current/hex"),
    path.posix.join(support, "service.sock"),
  ]
}
