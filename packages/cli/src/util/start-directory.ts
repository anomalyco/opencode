import path from "node:path"
import { Global } from "@opencode/util/global"

type Options = {
  readonly platform?: NodeJS.Platform
  readonly systemRoot?: string
  readonly home?: string
}

/**
 * UAC starts elevated consoles in %SystemRoot%\System32 and discards the
 * directory they were opened from. Treat the Windows system directories as
 * "no project chosen" so OpenCode opens the user's home directory instead of
 * making System32 the project root.
 */
export function resolveStartDirectory(input = process.cwd(), options: Options = {}) {
  if ((options.platform ?? process.platform) !== "win32") return input
  const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? process.env.windir
  if (!systemRoot) return input
  const directory = path.win32.resolve(input).toLowerCase()
  return ["System32", "SysWOW64"]
    .map((name) => path.win32.resolve(path.win32.join(systemRoot, name)).toLowerCase())
    .includes(directory)
    ? (options.home ?? Global.Path.home)
    : input
}
