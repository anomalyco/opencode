export * as SandboxPolicy from "./policy.js"

import path from "node:path"

/** Host-owned settings; project configuration and tool input cannot change these. */
export interface Options {
  readonly enabled?: boolean
  readonly approval?: "on-request" | "never"
  readonly fullDiskRead?: boolean
  readonly readableRoots?: readonly string[]
  readonly writableRoots?: readonly string[]
}

export interface Policy {
  readonly directory: string
  readonly fullDiskRead: boolean
  readonly readableRoots: readonly string[]
  readonly writableRoots: readonly string[]
  readonly protectedPaths: readonly string[]
  readonly unreadablePaths: readonly string[]
  readonly gitConfigFiles?: readonly string[]
  readonly referenceRoots?: readonly string[]
  readonly referenceDataRoots?: readonly string[]
  readonly referenceDeniedPaths?: readonly string[]
  readonly referenceDeniedPatterns?: readonly string[]
  readonly scratch: string
}

/** A final argv launch, constructed after hooks and authorization. */
export interface Launch {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Record<string, string | undefined>
}

// Do not forward the harness's credentials or shell startup injections to agent code.
export function environment(
  env: Record<string, string | undefined>,
  scratch: string,
): Record<string, string | undefined> {
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(
        ([name]) =>
          (!/^OPENCODE_/i.test(name) || name === "OPENCODE_SESSION_ID") &&
          !/(?:^|_)(?:API_KEY|ACCESS_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|AUTHORIZATION)(?:_|$)/i.test(name) &&
          !/^(?:CODEX_|DYLD_|BASH_ENV$|ENV$|ZDOTDIR$|NODE_OPTIONS$|BUN_OPTIONS$|SSH_AUTH_SOCK$|GIT_.*COMMAND$)/i.test(
            name,
          ),
      ),
    ),
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
    TMPPREFIX: path.join(scratch, "zsh"),
  }
}
