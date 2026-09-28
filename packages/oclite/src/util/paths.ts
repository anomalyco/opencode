import { existsSync } from "fs"
import os from "os"
import path from "path"
import { ascending } from "@opencode-ai/schema/identifier"

// Read at call time (not module load) so subprocesses with a temp HOME/XDG resolve correctly.
export function configDir() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "oclite")
}

export function dataDir() {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "oclite")
}

export const builtinAgentsDir = path.join(import.meta.dir, "..", "..", "agents")

/** Nearest ancestor of cwd holding `.oclite/` or `.git`, else cwd. */
export function projectRoot(cwd: string) {
  const found = ancestors(cwd).find(
    (dir) => existsSync(path.join(dir, ".oclite")) || existsSync(path.join(dir, ".git")),
  )
  return found ?? cwd
}

/** cwd and each parent directory up to the filesystem root. */
export function ancestors(cwd: string): string[] {
  const parent = path.dirname(cwd)
  if (parent === cwd) return [cwd]
  return [cwd, ...ancestors(parent)]
}

export function id(prefix: string) {
  return `${prefix}_${ascending()}`
}

export function isLoopback(url: string) {
  if (!URL.canParse(url)) return false
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "")
  return host === "localhost" || host === "::1" || host.startsWith("127.")
}
