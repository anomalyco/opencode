import { homedir } from "node:os"
import { resolve } from "node:path"

export function resolveDesktopPath(path: string) {
  if (path === "~") return resolve(homedir())
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(homedir(), path.slice(2))
  return resolve(path)
}
