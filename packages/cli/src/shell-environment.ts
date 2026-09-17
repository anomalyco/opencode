export * as ShellEnvironment from "./shell-environment"

import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

// Set on the probe shell so an rc file that itself starts opencode cannot recurse into another probe.
export const RESOLVING = "OPENCODE_RESOLVING_SHELL_ENVIRONMENT"

// Shell bookkeeping that describes the probe process, not the user's environment.
const TRANSIENT = new Set([RESOLVING, "SHLVL", "PWD", "OLDPWD", "_"])

export type Variables = Readonly<Record<string, string | undefined>>

/**
 * Resolve the environment of the user's interactive login shell when the current environment did
 * not come from one.
 *
 * A background service elected by a GUI client (the desktop app, an editor, a login item) inherits
 * launchd's environment: PATH is `/usr/bin:/bin:/usr/sbin:/sbin` and nothing exported from
 * `.zshrc` or `.bashrc` exists. Every process the server spawns extends `process.env`, so stdio MCP
 * servers using `#!/usr/bin/env node`, `npx`, `uvx`, formatters, and hooks fail with no useful error
 * while the bash tool, which prefers the client's terminal environment, keeps working. Editors such
 * as VS Code and Zed resolve the login shell at startup for the same reason.
 *
 * Returns `undefined` when there is nothing to adopt: Windows, an environment that already passed
 * through a shell (`SHLVL`), a probe already in progress, or a shell that fails to report.
 */
export const resolve = Effect.fnUntraced(function* (env: Variables = process.env) {
  if (process.platform === "win32") return undefined
  if (env[RESOLVING] !== undefined || env.SHLVL !== undefined) return undefined
  const spawner = yield* ChildProcessSpawner
  const marker = randomUUID()
  // Interactive and login: most PATH edits live in `.zshrc`/`.bashrc`, which only interactive shells read.
  // `env -0` keeps values containing newlines intact.
  const output = yield* spawner
    .string(
      ChildProcess.make(env.SHELL || "/bin/sh", ["-ilc", `printf '%s' '${marker}'; env -0; printf '%s' '${marker}'`], {
        env: { ...env, [RESOLVING]: "1" },
        stdin: "ignore",
        // Interactive shells without a terminal warn on stderr; nothing reads it, so never let it fill.
        stderr: "ignore",
      }),
    )
    .pipe(
      Effect.timeout("10 seconds"),
      Effect.tapError((error) => Effect.logWarning("shell environment unavailable", { error })),
      Effect.orElseSucceed(() => undefined),
    )
  if (output === undefined) return undefined
  const start = output.indexOf(marker)
  const end = output.lastIndexOf(marker)
  if (start === -1 || end === start) {
    yield* Effect.logWarning("shell environment unavailable", { shell: env.SHELL, reason: "missing markers" })
    return undefined
  }
  return Object.fromEntries(
    output
      .slice(start + marker.length, end)
      .split("\0")
      .flatMap((entry) => {
        const separator = entry.indexOf("=")
        if (separator <= 0) return []
        const key = entry.slice(0, separator)
        return TRANSIENT.has(key) ? [] : [[key, entry.slice(separator + 1)] as const]
      }),
  )
})

/** Apply the resolved login-shell environment to this process before anything reads `process.env`. */
export const adopt = Effect.fnUntraced(function* () {
  const variables = yield* resolve()
  if (variables === undefined) return
  Object.assign(process.env, variables)
  yield* Effect.logInfo("shell environment adopted", {
    shell: process.env.SHELL,
    variables: Object.keys(variables).length,
  })
})
