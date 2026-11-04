import whichPkg from "which"
import { statSync } from "fs"
import path from "path"

export function which(cmd: string, env?: NodeJS.ProcessEnv, bin?: string) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const full = base && bin ? base + path.delimiter + bin : base || bin
  const pathExt = env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt
  if (process.platform === "win32") return windows(cmd, full ?? "", pathExt || ".EXE;.CMD;.BAT;.COM")
  return whichPkg.sync(cmd, { nothrow: true, path: full, pathExt })
}

// The same search as `which`, which on Windows stats every PATH entry once per PATHEXT extension in each case and
// throws on every miss. Windows names ignore case, so one stat per extension finds the same file in under half the
// time. Lookups block the server and misses are common: Azure looks for `az` on every Location boot.
function windows(cmd: string, pathEnv: string, pathExt: string) {
  const listed = pathExt.split(";")
  const extensions = listed.filter(
    (ext, index) => listed.findIndex((other) => other.toLowerCase() === ext.toLowerCase()) === index,
  )
  const suffixes = cmd.includes(".") && extensions[0] !== "" ? ["", ...extensions] : extensions
  const dirs = /[\\/]/.test(cmd) ? [""] : [process.cwd(), ...pathEnv.split(";")]
  for (const entry of dirs) {
    const dir = /^".*"$/.test(entry) ? entry.slice(1, -1) : entry
    const file = (!dir && /^\.[\\/]/.test(cmd) ? cmd.slice(0, 2) : "") + path.join(dir, cmd)
    const found = suffixes.map((suffix) => file + suffix).find((candidate) => executable(candidate, extensions))
    if (found) return found
  }
  return null
}

function executable(file: string, extensions: readonly string[]) {
  if (!isFile(file)) return false
  const lower = file.toLowerCase()
  return extensions.some((ext) => ext === "" || lower.endsWith(ext.toLowerCase()))
}

// A PATH entry that is a file, or holds characters Windows rejects, throws rather than reporting no entry.
function isFile(file: string) {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isFile() === true
  } catch {
    return false
  }
}
