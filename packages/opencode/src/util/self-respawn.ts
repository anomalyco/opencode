/**
 * Cross-platform basename that recognises both `/` and `\` as separators so
 * paths from cross-built environments (Windows argv on a POSIX test runner,
 * cygwin tools, etc.) produce the same answer as the host's `path.basename`
 * would.
 */
function basename(p: string): string {
  const m = p.match(/[^/\\]+$/)
  return m ? m[0] : p
}

/**
 * Argv prefix to spawn the same CLI that produced this process.
 *
 * - Compiled binary mode (production opencode/securecode binary): returns
 *   `[binaryPath]` so children inherit the same compiled binary.
 * - Bun-run mode (`bun src/index.ts ...`): returns `[bunPath, scriptPath]`
 *   so children re-enter the same script under the same Bun runtime.
 *
 * Replaces hardcoded `"opencode"` strings on self-spawn paths so the binary
 * the user actually invoked (including symlinks, custom names, dev runs, and
 * downstream forks) is what gets respawned. Cf. the `pr` command's child
 * spawn path, which previously hardcoded the binary name and broke under
 * symlinks / canary builds / forks.
 */
export function selfRespawnArgv(argv: readonly string[] = process.argv): readonly string[] {
  const exe = argv[0]
  if (!exe) throw new Error("argv[0] is missing; cannot determine self binary")
  if (!isBunInterpreter(exe)) return [exe]
  const script = argv[1]
  if (!script) throw new Error("Bun runtime detected but argv[1] (script path) is missing")
  return [exe, script]
}

/**
 * Display name of the current binary, suitable for user-facing messages such
 * as "Starting <name>...". Returns the binary's basename (`opencode`,
 * `securecode`, etc.) for compiled binaries and `bun` for `bun src/...` dev
 * runs. Falls back to `"opencode"` if argv[0] is unexpectedly missing.
 */
export function selfDisplayName(argv: readonly string[] = process.argv): string {
  const exe = argv[0]
  if (!exe) return "opencode"
  return basename(exe)
}

function isBunInterpreter(exe: string): boolean {
  // Match the Bun runtime regardless of platform (`bun`, `bun-debug`, `bun.exe`,
  // `bun-canary` distros etc. all start with `bun` after the directory part).
  const base = basename(exe).toLowerCase()
  return /^bun(\b|[-_.])/.test(base)
}
