import { existsSync, lstatSync, readdirSync } from "fs"
import path from "path"

// Tests cannot create an app execution alias (an IO_REPARSE_TAG_APPEXECLINK reparse point), so they borrow one that
// a Microsoft Store app installed for the current user. Returns undefined when the machine has none, or none with
// the requested file name.
export function appExecutionAlias(file?: string) {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return
  const dir = path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps")
  if (!existsSync(dir)) return
  const name = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name.toLowerCase().endsWith(".exe"))
    .map((entry) => entry.name)
    .filter((entry) => file === undefined || entry.toLowerCase() === file)
    .find((entry) => lstatSync(path.join(dir, entry), { throwIfNoEntry: false })?.isSymbolicLink())
  return name ? { dir, name, file: path.join(dir, name) } : undefined
}
