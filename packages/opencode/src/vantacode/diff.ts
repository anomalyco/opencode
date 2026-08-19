/**
 * Minimal line-based diff with colored terminal rendering for VantaCode.
 *
 * Produces Claude-Code-style inline +/- diffs when the agent edits a file.
 * Dependency-free (pure LCS) so it unit tests under plain Node.
 */

export type DiffKind = "add" | "del" | "ctx"

export interface DiffLine {
  readonly kind: DiffKind
  readonly text: string
  /** 1-based line number in the old file (undefined for additions). */
  readonly oldNo?: number
  /** 1-based line number in the new file (undefined for deletions). */
  readonly newNo?: number
}

export interface DiffStat {
  readonly added: number
  readonly removed: number
}

const RESET = "\x1b[0m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const DIM = "\x1b[2m"

/** Compute a line-level diff between two texts using an LCS table. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.length === 0 ? [] : oldText.split("\n")
  const b = newText.length === 0 ? [] : newText.split("\n")
  const n = a.length
  const m = b.length

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let oldNo = 1
  let newNo = 1
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i], oldNo, newNo })
      i++
      j++
      oldNo++
      newNo++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: a[i], oldNo })
      i++
      oldNo++
    } else {
      out.push({ kind: "add", text: b[j], newNo })
      j++
      newNo++
    }
  }
  while (i < n) {
    out.push({ kind: "del", text: a[i], oldNo })
    i++
    oldNo++
  }
  while (j < m) {
    out.push({ kind: "add", text: b[j], newNo })
    j++
    newNo++
  }
  return out
}

export function diffStat(lines: DiffLine[]): DiffStat {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === "add") added++
    else if (line.kind === "del") removed++
  }
  return { added, removed }
}

export interface RenderOptions {
  /** Lines of unchanged context to keep around changes. Default 3. */
  readonly context?: number
  /** Emit ANSI colors. Default true. */
  readonly color?: boolean
  /** Optional file path shown in the header. */
  readonly path?: string
}

function colorize(line: DiffLine, color: boolean): string {
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "
  const body = `${sign} ${line.text}`
  if (!color) return body
  if (line.kind === "add") return `${GREEN}${body}${RESET}`
  if (line.kind === "del") return `${RED}${body}${RESET}`
  return `${DIM}${body}${RESET}`
}

/**
 * Render a diff with collapsed context. Long runs of unchanged lines are
 * replaced with a "⋯ N unchanged lines" marker.
 */
export function renderDiff(oldText: string, newText: string, options: RenderOptions = {}): string {
  const context = options.context ?? 3
  const color = options.color ?? true
  const lines = diffLines(oldText, newText)
  const stat = diffStat(lines)

  // Mark which lines are within `context` of a change.
  const keep = new Array<boolean>(lines.length).fill(false)
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].kind !== "ctx") {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
        keep[k] = true
      }
    }
  }

  const rows: string[] = []
  if (options.path) {
    const header = `${options.path}  (${GREEN}+${stat.added}${RESET} ${RED}-${stat.removed}${RESET})`
    rows.push(color ? header : `${options.path}  (+${stat.added} -${stat.removed})`)
  }

  let idx = 0
  while (idx < lines.length) {
    if (keep[idx]) {
      rows.push(colorize(lines[idx], color))
      idx++
      continue
    }
    // Collapse a run of dropped context.
    let run = 0
    while (idx < lines.length && !keep[idx]) {
      run++
      idx++
    }
    const marker = `  ⋯ ${run} unchanged line${run === 1 ? "" : "s"}`
    rows.push(color ? `${DIM}${marker}${RESET}` : marker)
  }

  return rows.join("\n")
}
