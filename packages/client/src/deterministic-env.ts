import { spawnSync } from "node:child_process"

let cachedPath: string | undefined | null = null

function parsePathFromEnvOutput(out: Buffer): string | undefined {
  const text = out.toString("utf8")
  for (const line of text.split("\0")) {
    if (line.startsWith("PATH=")) return line.slice(5)
  }
  return undefined
}

/**
 * Returns a deterministic PATH for the managed service, independent of the
 * spawning client's inherited environment.
 *
 * The service is a shared singleton elected from a herd of reconnecting
 * clients. If we inherit `process.env.PATH` verbatim, whichever client wins
 * the race determines the service's global PATH, making shell command
 * resolution nondeterministic.
 *
 * We derive the canonical PATH from the user's login shell (`-l` → `-il`
 * fallback is handled inside the shell probe). This is the same technique
 * Desktop uses in `packages/desktop/src/main/service/shell-env.ts` and is
 * bounded (5s timeout, no secrets). On failure we fall back to the current
 * process's PATH so the service remains operable.
 *
 * The result is cached for the lifetime of the process – the login shell's
 * PATH does not change without a user-initiated shell reload, and caching
 * avoids a 5s spawnSync on every contender spawn.
 */
export function getDeterministicPath(): string | undefined {
  if (cachedPath !== null) return cachedPath ?? undefined

  // Prefer login shell probe with a clean env, not the polluted client PATH.
  // The service is elected from a herd of clients with different PATHs; inheriting
  // whichever client wins makes command resolution nondeterministic.
  const shell = process.env.SHELL || (process.platform === "win32" ? undefined : "/bin/sh")
  if (shell) {
    for (const mode of ["-l", "-il"] as const) {
      try {
        // Use a minimal env without the client's PATH so the probe returns the
        // login shell's canonical PATH, not the winner's polluted PATH.
        const cleanEnv: Record<string, string | undefined> = {
          HOME: process.env.HOME,
          USER: process.env.USER,
          LOGNAME: process.env.LOGNAME,
          SHELL: process.env.SHELL,
          // Provide a minimal PATH so `env` can be found even before the shell sets its own
          PATH: "/usr/local/bin:/usr/bin:/bin",
        }
        // Preserve non-PATH vars that shells may need, but explicitly exclude PATH/Path
        for (const [k, v] of Object.entries(process.env)) {
          if (k === "PATH" || k === "Path") continue
          if (cleanEnv[k] === undefined) cleanEnv[k] = v
        }
        const out = spawnSync(shell, [mode, "-c", "env -0"], {
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 2_000,
          windowsHide: true,
          env: cleanEnv as NodeJS.ProcessEnv,
        })
        if (out.error) continue
        if (out.status !== 0) continue
        if (!out.stdout || out.stdout.length === 0) continue
        const path = parsePathFromEnvOutput(out.stdout)
        if (path !== undefined && path.length > 0) {
          cachedPath = path
          return path
        }
      } catch {
        // ignore and try next mode
      }
    }
  }

  // Fallback: fixed system PATH (deterministic, no secrets)
  cachedPath = "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"
  return cachedPath
}

export function resetDeterministicPathCache() {
  cachedPath = null
}
