import whichPkg from "which"
import path from "path"
import { existsSync, lstatSync } from "fs"

export function which(cmd: string, env?: NodeJS.ProcessEnv, bin?: string) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const full = base && bin ? base + path.delimiter + bin : base || bin
  return (
    whichPkg.sync(cmd, {
      nothrow: true,
      path: full,
      pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
    }) ?? appExecutionAlias(cmd, full)
  )
}

// Microsoft Store apps, such as PowerShell 7, put app execution aliases in WindowsApps on PATH. They launch like
// any executable, but stat rejects them with EACCES, so `which` skips them.
export function isAppExecutionAlias(file: string) {
  return (
    process.platform === "win32" &&
    lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true &&
    existsSync(file)
  )
}

function appExecutionAlias(cmd: string, search: string | undefined) {
  if (process.platform !== "win32" || !search || path.win32.dirname(cmd) !== ".") return null
  const name = path.win32.extname(cmd).toLowerCase() === ".exe" ? cmd : cmd + ".exe"
  return (
    search
      .split(path.win32.delimiter)
      .filter(Boolean)
      .map((dir) => path.win32.join(dir.replace(/^"(.*)"$/, "$1"), name))
      .find(isAppExecutionAlias) ?? null
  )
}
