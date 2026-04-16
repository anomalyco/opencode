/**
 * Pure helpers for driving `rg`. No fs, no subprocess — the primitive
 * layer calls `exec`/`execStream` through the Backend and feeds the
 * stdout into `parseRgJsonLine`.
 *
 *   rgArgs(...)              → string[] argv (WITHOUT the rg binary path)
 *   parseRgJsonLine(line)    → typed hit or null (non-match rows)
 */

export interface RgHit {
  readonly path: { readonly text: string }
  readonly lines: { readonly text: string }
  readonly line_number: number
  readonly absolute_offset: number
  readonly submatches: ReadonlyArray<{
    readonly match: { readonly text: string }
    readonly start: number
    readonly end: number
  }>
}

export interface RgArgsInput {
  readonly mode: "files" | "search"
  readonly glob?: ReadonlyArray<string>
  readonly hidden?: boolean
  readonly follow?: boolean
  readonly maxDepth?: number
  readonly limit?: number
  readonly pattern?: string
  readonly file?: ReadonlyArray<string>
}

/**
 * Build a ripgrep argv suffix (without the binary path at argv[0]).
 * Matches the shape Ripgrep.args from v1 to preserve semantics.
 */
export function rgArgs(input: RgArgsInput): string[] {
  const out: string[] = [input.mode === "search" ? "--json" : "--files", "--glob=!.git/*"]
  if (input.follow) out.push("--follow")
  if (input.hidden !== false) out.push("--hidden")
  if (input.maxDepth !== undefined) out.push(`--max-depth=${input.maxDepth}`)
  if (input.glob) {
    for (const g of input.glob) out.push(`--glob=${g}`)
  }
  if (input.limit) out.push(`--max-count=${input.limit}`)
  if (input.mode === "search") out.push("--no-messages")
  if (input.pattern !== undefined) {
    out.push("--", input.pattern)
    if (input.file && input.file.length > 0) {
      for (const f of input.file) out.push(f)
    } else {
      // Explicit "." forces rg to search the cwd instead of reading
      // stdin when the spawn leaves stdin open (the default). Without
      // this, rg --json with no path blocks forever waiting on stdin.
      out.push(".")
    }
  }
  return out
}

/**
 * Parse a single `rg --json` stdout line into an RgHit, or `null` for
 * non-match rows (begin/end/summary/invalid).
 */
export function parseRgJsonLine(line: string): RgHit | null {
  if (!line) return null
  try {
    const row = JSON.parse(line)
    if (row?.type !== "match") return null
    const data = row.data
    if (!data || typeof data !== "object") return null
    if (!data.path?.text || !data.lines?.text || typeof data.line_number !== "number") return null
    return data as RgHit
  } catch {
    return null
  }
}
