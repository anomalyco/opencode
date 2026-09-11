export type CodePath = {
  path: string
  line?: number
}

const LINE_SUFFIX = /^(.+?):(\d+)(?::\d+)?$/

/**
 * Parses an inline-code span classified as a path into a file target with an
 * optional trailing line (and column) reference, e.g. `src/app.tsx:301`.
 */
export function codePath(text: string | undefined | null): CodePath | undefined {
  const value = text?.trim()
  if (!value) return
  if (/^https?:\/\//i.test(value)) return
  if (/\s/.test(value)) return

  const match = value.match(LINE_SUFFIX)
  if (!match) return { path: value }

  const line = Number(match[2])
  return line >= 1 ? { path: match[1]!, line } : { path: match[1]! }
}
