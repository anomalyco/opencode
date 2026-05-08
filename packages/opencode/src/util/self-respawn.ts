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
 * - Compiled binary mode (production opencode binary): returns `[binaryPath]`
 *   so children inherit the same compiled binary.
 * - Bun-run mode (`bun src/index.ts ...`): returns `[bunPath, scriptPath]`
 *   so children re-enter the same script under the same Bun runtime.
 *
 * Replaces hardcoded `"opencode"` strings on self-spawn paths so the binary
 * the user actually invoked is what gets respawned. The literal `"opencode"`
 * in `pr.ts`'s spawn path routes children to whichever `opencode` `$PATH`
 * happens to resolve, regardless of how the parent was launched — that
 * misroutes under symlinks (`oc -> opencode`), side-by-side installs
 * (`opencode-canary` should respawn itself), `bun src/index.ts` dev runs
 * (the script path is needed in addition to the bun binary), and any
 * rename or wrapper script.
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
