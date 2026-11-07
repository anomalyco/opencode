export * as ShellEnv from "./shell-env"

import { spawn } from "node:child_process"
import { userInfo } from "node:os"
import { Effect, Option, Path } from "effect"

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

const run = (shell: string, mode: "-il" | "-l") =>
  Effect.callback<{ type: "Exited"; status: number | null; stdout: Buffer } | { type: "Failed"; error: Error }>(
    (resume) => {
      const child = spawn(shell, [mode, "-c", "env -0"], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      })
      const chunks: Buffer[] = []
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
      child.on("error", (error) => resume(Effect.succeed({ type: "Failed", error })))
      child.on("close", (status) => resume(Effect.succeed({ type: "Exited", status, stdout: Buffer.concat(chunks) })))

      return Effect.sync(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      })
    },
  )

const probe = Effect.fn("ShellEnv.probe")(function* (shell: string, mode: "-il" | "-l") {
  const out = yield* run(shell, mode).pipe(Effect.timeoutOption(TIMEOUT))

  if (Option.isNone(out)) return { type: "Timeout" } satisfies Probe

  if (out.value.type === "Failed") {
    yield* Effect.logWarning(`[server] Shell env probe failed for ${shell} ${mode}: ${out.value.error.message}`)

    return { type: "Unavailable" } satisfies Probe
  }

  if (out.value.status !== 0) {
    yield* Effect.logWarning(`[server] Shell env probe exited with non-zero status for ${shell} ${mode}`)

    return { type: "Unavailable" } satisfies Probe
  }

  const env = parseShellEnv(out.value.stdout)

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

// The probe runs the user's rc files, which can take seconds. Only processes this app starts need its
// result, so it resolves in the background and they wait for it here instead of holding up startup.
let applied = Promise.resolve()

export function applyInBackground(env: Promise<Record<string, string> | null>, overrides: Record<string, string>) {
  applied = env.then((value) => {
    if (value) Object.assign(process.env, value, overrides)
  })
}

export const ready = Effect.promise(() => applied)
