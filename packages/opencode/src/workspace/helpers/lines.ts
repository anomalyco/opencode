/**
 * Pure line-slicing helper used by Workspace.Primitives.readFileLines.
 *
 * Operates on raw UTF-8 bytes so it is substrate-agnostic: whether the
 * bytes came from a local file or a remote sandbox, the algorithm is
 * identical.
 */

export interface LinesView {
  /** The sliced, possibly-truncated lines. */
  readonly raw: string[]
  /** Total number of lines encountered up to where we stopped. */
  readonly count: number
  /**
   * True if the slice stopped because the cumulative byte budget was
   * exceeded — callers often use this to hint "content was truncated".
   */
  readonly cut: boolean
  /** True if more lines exist beyond what we returned. */
  readonly more: boolean
  /** Echo of `opts.offset` so callers can trace back. */
  readonly offset: number
}

const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024

/**
 * Slice `bytes` into a LinesView given a 1-based `offset` and `limit`.
 *
 *  - Lines are split by `\n` / `\r\n` (crlfDelay).
 *  - Lines longer than MAX_LINE_LENGTH are truncated with a suffix.
 *  - Total byte budget is MAX_BYTES; exceeding it sets `cut = more = true`.
 *  - `offset` is 1-based (matches the tool-facing contract in v1).
 */
export function sliceLines(bytes: Uint8Array, opts: { offset: number; limit: number }): LinesView {
  const text = new TextDecoder("utf8").decode(bytes)
  // Normalize CRLF so line counts match the tool-level contract.
  const allLines = text.split(/\r?\n/)
  // A trailing "" from a final newline should NOT count as an extra
  // line. v1 used readline which elides it too.
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") allLines.pop()

  const start = opts.offset - 1
  const raw: string[] = []
  let bytesUsed = 0
  let count = 0
  let cut = false
  let more = false

  for (let i = 0; i < allLines.length; i++) {
    count += 1
    if (count <= start) continue

    if (raw.length >= opts.limit) {
      more = true
      continue
    }

    const src = allLines[i]
    const line = src.length > MAX_LINE_LENGTH ? src.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : src
    const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
    if (bytesUsed + size > MAX_BYTES) {
      cut = true
      more = true
      break
    }
    raw.push(line)
    bytesUsed += size
  }

  return { raw, count, cut, more, offset: opts.offset }
}
