import path from "path"
import { which } from "./which.js"

export function resolveGitExecutable(platform: NodeJS.Platform, resolved: string | null) {
  if (platform !== "win32" || !resolved) return "git"
  return path.resolve(resolved)
}

const resolved = process.platform === "win32" ? which("git") : null

export const gitExecutable = resolveGitExecutable(process.platform, resolved)
