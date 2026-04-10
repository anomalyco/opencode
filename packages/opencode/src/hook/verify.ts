import { access, constants, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { HookConfig } from "./schema"

export interface VerifyResult {
  orphanScripts: string[]
  missingScripts: string[]
  permissionErrors: string[]
}

/**
 * Verify hook deployment integrity by comparing the hook directory contents
 * against the registered config entries.
 *
 * Detects:
 * - Orphan scripts: files in hookDir not referenced by any config entry
 * - Missing scripts: config entries pointing to scripts that do not exist
 * - Permission errors: scripts that exist but lack execute permission
 */
export async function verifyHookDeployment(
  hookDir: string,
  config: HookConfig,
): Promise<VerifyResult> {
  const resolvedDir = resolve(hookDir)
  const result: VerifyResult = {
    orphanScripts: [],
    missingScripts: [],
    permissionErrors: [],
  }

  // Collect all script paths referenced in config
  const referencedPaths = extractScriptPaths(config, resolvedDir)

  // List scripts on disk
  const diskScripts = await listScripts(resolvedDir)

  // Orphan detection: scripts on disk not referenced in config
  for (const scriptPath of diskScripts) {
    if (!referencedPaths.has(scriptPath)) {
      result.orphanScripts.push(scriptPath)
    }
  }

  // Missing + permission checks for referenced paths
  const checks = [...referencedPaths].map(async (scriptPath) => {
    const exists = await fileExists(scriptPath)
    if (!exists) {
      result.missingScripts.push(scriptPath)
      return
    }
    const executable = await isExecutable(scriptPath)
    if (!executable) {
      result.permissionErrors.push(scriptPath)
    }
  })
  await Promise.all(checks)

  return result
}

function extractScriptPaths(config: HookConfig, hookDir: string): Set<string> {
  const paths = new Set<string>()
  if (!config) return paths

  const events = ["PreToolUse", "PostToolUse", "SessionStart", "Notification"] as const
  for (const event of events) {
    const entries = config[event]
    if (!entries) continue
    for (const entry of entries) {
      const scriptPath = resolveScriptPath(entry.command, hookDir)
      if (scriptPath) paths.add(scriptPath)
    }
  }
  return paths
}

/**
 * Extract the script file path from a hook command string.
 * Handles:
 * - Direct paths: `/path/to/script.sh`
 * - Tilde paths: `~/hooks/script.sh`
 * - Commands with args: `/path/to/script.sh --flag`
 * - Inline shell (no path): `echo "hello"` -> returns null
 */
function resolveScriptPath(command: string, hookDir: string): string | null {
  const expanded = command.replace(/^~/, process.env.HOME ?? "~")
  const firstToken = expanded.split(/\s+/)[0]
  if (!firstToken) return null

  // Only treat as a file path if it contains a slash (absolute or relative)
  if (!firstToken.includes("/")) return null

  // Resolve relative paths against hookDir
  if (!firstToken.startsWith("/")) {
    return resolve(hookDir, firstToken)
  }
  return firstToken
}

async function listScripts(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".sh"))
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
