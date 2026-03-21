import fs from "fs/promises"
import path from "path"
import { $ } from "bun"

function output(input: Uint8Array | undefined) {
  if (!input?.length) return ""
  return new TextDecoder().decode(input).trim()
}

function error(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
  return [output(result.stderr), output(result.stdout)].filter(Boolean).join("\n")
}

export async function validateWorkspace(directory: string) {
  const resolved = await fs.realpath(path.resolve(directory)).catch(() => undefined)
  if (!resolved) return { valid: false as const, reason: "Workspace directory not found" }

  const stat = await fs.stat(resolved).catch(() => undefined)
  if (!stat?.isDirectory()) return { valid: false as const, reason: "Workspace directory is not a directory" }
  if (!Bun.which("git")) return { valid: false as const, reason: "Git is not installed" }

  const topResult = await $`git rev-parse --show-toplevel`.quiet().nothrow().cwd(resolved)
  if (topResult.exitCode !== 0) {
    return {
      valid: false as const,
      reason: error(topResult) || "Workspace is not a git repository",
    }
  }

  const topText = output(topResult.stdout)
  if (!topText) {
    return {
      valid: false as const,
      reason: "Workspace is not a git repository",
    }
  }

  const top = path.resolve(resolved, topText)
  const commonResult = await $`git rev-parse --git-common-dir`.quiet().nothrow().cwd(resolved)
  if (commonResult.exitCode !== 0) {
    return {
      valid: false as const,
      reason: error(commonResult) || "Workspace is not a valid git worktree",
      top,
    }
  }

  const commonText = output(commonResult.stdout)
  if (!commonText) {
    return {
      valid: false as const,
      reason: "Workspace is not a valid git worktree",
      top,
    }
  }

  const common = (() => {
    const dirname = path.dirname(commonText)
    if (dirname === ".") return top
    return path.resolve(resolved, dirname)
  })()

  return {
    valid: true as const,
    directory: resolved,
    top,
    common,
  }
}
