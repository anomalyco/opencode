// SEC-03: No external call sites found as of 2026-03-26. Guard is in module itself.
import path from "path"
import { Config } from "../config/config"

export async function safePath(base: string, userInput: string): Promise<string | null> {
  const cfg = await Config.get()
  if (cfg.security?.pathTraversal?.enabled === false) {
    return path.resolve(base, userInput.replace(/\0/g, ""))
  }
  if (userInput.includes("\0")) return null
  const resolvedBase = path.resolve(base)
  const joined = path.resolve(base, userInput)
  if (!joined.startsWith(resolvedBase + path.sep) && joined !== resolvedBase) {
    return null
  }
  return joined
}
