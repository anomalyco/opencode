import { existsSync, realpathSync } from "node:fs"
import path from "path"
import { lazy } from "./lazy.js"
import { which } from "./which.js"

const darwinShim = "/usr/bin/git"
const xcodeSelectLink = "/var/db/xcode_select_link"

const defaultDeveloperDirs = [
  "/Applications/Xcode.app/Contents/Developer",
  "/Library/Developer/CommandLineTools",
]

function readXcodeSelectLink(link: string) {
  if (!existsSync(link)) return null
  try {
    return realpathSync(link)
  } catch {
    return null
  }
}

export function darwinDeveloperDirs(
  developerDir = process.env.DEVELOPER_DIR?.trim(),
  readLink: (link: string) => string | null = readXcodeSelectLink,
) {
  if (developerDir) return [developerDir]
  const selected = readLink(xcodeSelectLink)
  return selected ? [selected, ...defaultDeveloperDirs] : defaultDeveloperDirs
}

export function resolveGitExecutable(
  platform: NodeJS.Platform,
  resolved: string | null,
  options?: {
    developerDirs?: readonly string[]
    exists?: (file: string) => boolean
  },
) {
  if (platform === "win32") return resolved ? path.resolve(resolved) : "git"
  if (platform !== "darwin" || !resolved) return "git"
  const full = path.posix.resolve(resolved)
  if (full !== darwinShim) return full
  const exists = options?.exists ?? existsSync
  const dirs = options?.developerDirs ?? darwinDeveloperDirs()
  return (
    dirs
      .filter((dir) => Boolean(dir) && path.posix.isAbsolute(dir))
      .map((dir) => path.posix.join(dir, "usr/bin/git"))
      .find((candidate) => candidate !== darwinShim && exists(candidate)) ?? "git"
  )
}

export const gitExecutable = lazy(() =>
  resolveGitExecutable(
    process.platform,
    process.platform === "win32" || process.platform === "darwin" ? which("git") : null,
  ),
)
