import { spawnSync } from "node:child_process"
import { userInfo } from "node:os"
import { Effect, Path } from "effect"

const TIMEOUT = 5_000

type Probe = { type: "Loaded"; value: Record<string, string> } | { type: "Timeout" } | { type: "Unavailable" }
export function resolveUserShell(envShell: string | undefined, loginShell: string | null | undefined) {
  const resolvedLoginShell = loginShell && loginShell !== "unknown" ? loginShell : undefined
  return envShell || resolvedLoginShell || "/bin/sh"
}

export function getUserShell() {
  try {
    return resolveUserShell(process.env.SHELL, userInfo().shell)
  } catch {
    return resolveUserShell(process.env.SHELL, undefined)
  }
}

export function parseShellEnv(out: Buffer) {
  const env: Record<string, string> = {}
  for (const line of out.toString("utf8").split("\0")) {
    if (!line) continue
    const ix = line.indexOf("=")
    if (ix <= 0) continue
    env[line.slice(0, ix)] = line.slice(ix + 1)
  }
  return env
}

const probe = Effect.fn("ShellEnv.probe")(function* (shell: string, mode: "-il" | "-l") {
  const out = spawnSync(shell, [mode, "-c", "env -0"], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: TIMEOUT,
    windowsHide: true,
  })

  const err = out.error as NodeJS.ErrnoException | undefined
  if (err) {
    if (err.code === "ETIMEDOUT") return { type: "Timeout" } satisfies Probe
    yield* Effect.logWarning(`[server] Shell env probe failed for ${shell} ${mode}: ${err.message}`)
    return { type: "Unavailable" } satisfies Probe
  }

  if (out.status !== 0) {
    yield* Effect.logWarning(`[server] Shell env probe exited with non-zero status for ${shell} ${mode}`)
    return { type: "Unavailable" } satisfies Probe
  }

  const env = parseShellEnv(out.stdout)
  if (Object.keys(env).length === 0) {
    yield* Effect.logWarning(`[server] Shell env probe returned empty env for ${shell} ${mode}`)
    return { type: "Unavailable" } satisfies Probe
  }

  return { type: "Loaded", value: env } satisfies Probe
})

export const isNushell = Effect.fn("ShellEnv.isNushell")(function* (shell: string) {
  const path = yield* Path.Path
  const name = path.basename(shell).toLowerCase()
  const raw = shell.toLowerCase()
  return name === "nu" || name === "nu.exe" || raw.endsWith("\\nu.exe")
})

export const loadShellEnv = Effect.fn("ShellEnv.load")(function* (shell: string) {
  if (yield* isNushell(shell)) {
    yield* Effect.logInfo(`[server] Skipping shell env probe for nushell: ${shell}`)
    return null
  }

  const interactive = yield* probe(shell, "-il")
  if (interactive.type === "Loaded") {
    yield* Effect.logInfo(`[server] Loaded shell environment with -il (${Object.keys(interactive.value).length} vars)`)
    return interactive.value
  }
  if (interactive.type === "Timeout") {
    yield* Effect.logInfo(`[server] Interactive shell env probe timed out: ${shell}`)
    return null
  }

  const login = yield* probe(shell, "-l")
  if (login.type === "Loaded") {
    yield* Effect.logInfo(`[server] Loaded shell environment with -l (${Object.keys(login.value).length} vars)`)
    return login.value
  }

  yield* Effect.logInfo(`[server] Falling back to app environment: ${shell}`)
  return null
})

export function mergeShellEnv(shell: Record<string, string> | null, env: Record<string, string>) {
  return {
    ...shell,
    ...env,
  }
}
