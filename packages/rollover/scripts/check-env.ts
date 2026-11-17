import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export interface CheckEnvOptions {
  sandboxRoot: string
  forkRoot: string
  /** Extra paths that must not reference the global installation (e.g. computed data dirs). */
  extraPaths?: string[]
}

export type CheckEnvResult = { ok: true } | { ok: false; failures: string[] }

/** Sandbox name prefix under any accepted temp root (see scripts/dev-opencode.sh). */
export const SANDBOX_PREFIX = "opencode-rollover-"
const GLOBAL_INSTALL_MARKER = "ai.opencode.desktop"

/** Accepted temp roots: /tmp, /private/tmp (macOS symlink target) and os.tmpdir(). */
function sandboxRoots(): string[] {
  const roots = new Set(["/tmp", "/private/tmp", os.tmpdir()])
  return [...roots].map((root) => path.join(root, SANDBOX_PREFIX))
}

export async function checkEnv(opts: CheckEnvOptions): Promise<CheckEnvResult> {
  const failures: string[] = []

  const sandboxOk = sandboxRoots().some((prefix) => opts.sandboxRoot.startsWith(prefix))
  if (!sandboxOk) {
    failures.push(
      `sandbox root must live under one of ${sandboxRoots().join(", ")} (got ${opts.sandboxRoot}); refusing to run against a non-sandboxed location`,
    )
  }

  const cliPkg = path.join(opts.forkRoot, "packages", "cli", "package.json")
  if (!existsSync(cliPkg)) {
    failures.push(`fork root does not look like the fork (missing ${cliPkg})`)
  }

  // The fork-built binary, when present, must live inside the fork tree.
  const bin = path.join(opts.forkRoot, "packages", "cli", "dist", "rollover-test", "opencode")
  if (existsSync(bin) && !bin.startsWith(opts.forkRoot)) {
    failures.push(`fork binary path escapes the fork tree: ${bin}`)
  }

  for (const p of [opts.sandboxRoot, ...(opts.extraPaths ?? [])]) {
    if (p.includes(GLOBAL_INSTALL_MARKER)) {
      failures.push(`global installation referenced in a sandbox path: ${p}`)
    }
  }

  return failures.length === 0 ? { ok: true } : { ok: false, failures }
}
