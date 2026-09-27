const SPAWN = "flatpak-spawn"

/**
 * True when the process is running inside a Flatpak sandbox.
 * Flatpak sets FLATPAK_ID (and FLATPAK_SANDBOX_DIR) for every sandboxed app.
 */
export const inFlatpak = () => typeof process.env.FLATPAK_ID === "string" && process.env.FLATPAK_ID !== ""

/**
 * True when agent-spawned commands should be routed to the host.
 *
 * The desktop Flatpak manifest opts in by setting OPENCODE_FLATPAK_HOST=1.
 * It is deliberately explicit (rather than keyed only on `inFlatpak()`) so
 * normal development runs and the existing test suite are unaffected.
 */
export const hostCommandsEnabled = () => process.env.OPENCODE_FLATPAK_HOST === "1"

export type SpawnOptions = {
  cwd?: string
  shell?: boolean | string
}

export type HostSpawn = {
  command: string
  args: string[]
  shell: boolean | string | undefined
}

/**
 * Rewrite a process spawn so it executes on the host when running in a Flatpak
 * with host-command routing enabled.
 *
 * A sandboxed Flatpak has no host PATH or toolchain, so an agent that shells out
 * to git/node/compilers/etc. must escape the sandbox via `flatpak-spawn --host`.
 * With `--filesystem=host` the sandbox and host share the same absolute paths,
 * so `cwd` is passed through unchanged as `--directory`.
 *
 * - A string `shell` (the common opencode case: `childProcess(shell)` runs
 *   `<shell> -c <command>`) is rebuilt on the host rather than onto
 *   flatpak-spawn's argv, which cross-spawn would otherwise corrupt.
 * - `shell: true` (host default shell) is left unchanged; opencode does not emit
 *   it today.
 * - Nested `flatpak-spawn` invocations are left untouched to avoid double wrapping.
 */
export function hostSpawn(command: string, args: string[], options: SpawnOptions = {}): HostSpawn {
  if (!hostCommandsEnabled()) return { command, args, shell: options.shell }
  if (command === SPAWN) return { command, args, shell: options.shell }

  const dir = options.cwd ? ["--directory", options.cwd] : []

  if (typeof options.shell === "string") {
    return { command: SPAWN, args: ["--host", ...dir, options.shell, "-c", command], shell: false }
  }

  if (options.shell === true) return { command, args, shell: options.shell }

  return { command: SPAWN, args: ["--host", ...dir, command, ...args], shell: false }
}