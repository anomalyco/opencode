import whichPkg from "which"
import path from "path"
import { existsSync } from "fs"
import { Global } from "../global"

// nvm and npm ship `.ps1` shims next to `.cmd`. Bun/Windows may resolve the
// `.ps1` and ShellExecute it as a document (Notepad) instead of running it.
const WINDOWS_SPAWN_EXTS = new Set([".com", ".exe", ".bat", ".cmd"])

export function preferWindowsSpawnPath(paths: readonly string[]) {
  return paths.find((item) => WINDOWS_SPAWN_EXTS.has(path.extname(item).toLowerCase())) ?? paths[0]
}

export function resolveWindowsSpawnFile(file: string, env?: NodeJS.ProcessEnv) {
  if (process.platform !== "win32") return file
  const ext = path.extname(file).toLowerCase()
  if (WINDOWS_SPAWN_EXTS.has(ext)) return file
  if (ext === ".ps1") {
    return windowsSpawnSibling(file) ?? which(path.basename(file.slice(0, -ext.length)), env) ?? file
  }
  return which(file, env) ?? file
}

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const full = base ? base + path.delimiter + Global.Path.bin : Global.Path.bin
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: full,
    pathExt: windowsSpawnPathExt(env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt),
  })
  if (typeof result !== "string") return null
  if (process.platform !== "win32") return result
  if (WINDOWS_SPAWN_EXTS.has(path.extname(result).toLowerCase())) return result
  return windowsSpawnSibling(result) ?? result
}

function windowsSpawnPathExt(raw: string | undefined) {
  if (process.platform !== "win32" || !raw) return raw
  const parts = raw.split(";").filter((ext) => ext.toUpperCase() !== ".PS1")
  return parts.join(";") || raw
}

function windowsSpawnSibling(file: string) {
  const ext = path.extname(file)
  if (ext.toLowerCase() !== ".ps1") return
  const base = file.slice(0, -ext.length)
  return [".cmd", ".exe", ".bat", ".com"].map((next) => base + next).find((candidate) => existsSync(candidate))
}
