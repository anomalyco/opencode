// Shared normalization helpers for cross-OS-stable snapshot tests.
//
// Every snapshot test that captures subprocess output, file paths, or other
// OS-flavored strings hits the same two issues:
//   1. Bun emits CRLF line endings on Windows stderr; LF elsewhere.
//   2. Path separators differ (\ on Windows, / on POSIX), and macOS's
//      /var/folders symlink resolves to /private/var/folders.
//
// These helpers exist so each test doesn't reinvent the same regexes.
//
// Use individually for fine-grained control, or compose them via
// `normalizeForSnapshot` for the common "snapshot subprocess output" path.
import fs from "node:fs"
import os from "node:os"

const TMP = os.tmpdir()
const REAL_TMP = fs.realpathSync(TMP)

/**
 * Collapses CRLF to LF. Bun's subprocess pipes emit native line endings —
 * snapshots captured on macOS/Linux contain LF, so a Windows run without
 * this step always diffs.
 */
export function stripCrlf(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

/**
 * Converts Windows-style `\` separators to POSIX `/` so paths render
 * identically across OSes. Use for path strings you want stable in a
 * snapshot, not for filesystem operations.
 */
export function toPosixPath(p: string): string {
  return p.replaceAll("\\", "/")
}

/**
 * Strips both the OS-level `os.tmpdir()` and its realpath form (macOS
 * `/var/folders` → `/private/var/folders`) from text, replacing each
 * occurrence with `marker` (default `<TMPDIR>`).
 */
export function withTmpdirStripped(text: string, marker = "<TMPDIR>"): string {
  return text.replaceAll(REAL_TMP, marker).replaceAll(TMP, marker)
}

/**
 * Separator-agnostic match class for path-style strings. Use inside a
 * larger regex when you want to match both `/` (POSIX) and `\` (Windows)
 * boundaries — e.g. `<TMPDIR>${PATH_SEP}oc-cli-[a-z0-9]+`.
 */
export const PATH_SEP = "[/\\\\]"

/**
 * One-shot normalization for the common case: strip CRLF, strip tmpdir,
 * then apply any caller-supplied path regex substitutions. Does NOT
 * blanket-replace `\` with `/` — that would mangle non-path backslash
 * content (regex literals in help text, etc.). Use `toPosixPath` or
 * `PATH_SEP` in your own regex when you need separator agnosticism.
 */
export function normalizeForSnapshot(
  text: string,
  options?: {
    readonly tmpdirMarker?: string
    readonly pathReplacements?: ReadonlyArray<readonly [RegExp, string]>
  },
): string {
  let out = stripCrlf(text)
  out = withTmpdirStripped(out, options?.tmpdirMarker)
  for (const [pattern, replacement] of options?.pathReplacements ?? []) {
    out = out.replace(pattern, replacement)
  }
  return out
}
