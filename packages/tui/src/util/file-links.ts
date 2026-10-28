import { statSync } from "node:fs"
import path from "node:path"

export type PathLinkCandidate = {
  text: string
  start: number
  end: number
  markerAt: number
}

export type PathLinkPart = { id: string; text: string }

export type DetectedPathLink = {
  index: number
  partID: string
  display: string
  path: string
  line?: number
  column?: number
  kind?: "file" | "directory"
  exists: boolean
}

export type PathLinkMarker = { at: number; index: number }

export type PathLinkDetection = {
  links: DetectedPathLink[]
  parts: Map<string, { text: string; markers: PathLinkMarker[] }>
}

export type PathLinkOptions = {
  base: string
}

const MAX_SUFFIX_LINE = 1_000_000

const fencePattern = /^ {0,3}(`{3,}|~{3,})/

const barePattern =
  /(?<![\w@.:/\\-])(?:(?:\.{1,2}[\\/]|\/)[^\s`"'<>|]*|[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)+|[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9._-]+[\\/])(?![\w/\\])/g

const explicitPattern = /^(?:\.{1,2}[\\/]|\/)/

/** Every candidate path the transcript exposes, in source order. */
export function scanPathCandidates(markdown: string): PathLinkCandidate[] {
  const candidates: PathLinkCandidate[] = []
  let offset = 0
  let fence: { char: string; length: number } | undefined
  for (const line of markdown.split("\n")) {
    const start = offset
    offset += line.length + 1
    const marker = fencePattern.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence.char && marker.length >= fence.length) fence = undefined
      continue
    }
    if (marker) {
      fence = { char: marker[0]!, length: marker.length }
      continue
    }
    scanLine(line, start, candidates)
  }
  return candidates
}

/**
 * Turns detected links into markers for one already-scanned text, separated
 * from the path by a space so the number reads as a tag. Offsets are only valid
 * for the exact text that produced the detection.
 */
export function applyPathLinkMarkers(
  text: string,
  markers: readonly PathLinkMarker[],
  format: (index: number) => string = (index) => `[${index}]`,
) {
  if (!markers.length) return text
  const ordered = [...markers].sort((left, right) => left.at - right.at)
  let result = ""
  let cursor = 0
  for (const marker of ordered) {
    if (marker.at < cursor || marker.at > text.length) continue
    // Keep `path [1](x)` from becoming a Markdown link with the label `1`.
    const spacer = text[marker.at] === "(" || text[marker.at] === "[" ? " " : ""
    result += `${text.slice(cursor, marker.at)} ${format(marker.index)}${spacer}`
    cursor = marker.at
  }
  return result + text.slice(cursor)
}

export type PathLinkDigitResult = {
  /** Digits accepted so far; empty after an invalid prefix. */
  digits: string
  matches: readonly DetectedPathLink[]
  exact?: DetectedPathLink
  invalid: boolean
  /** The rejected prefix, for feedback. */
  attempted?: string
}

/** Applies one typed digit to a path number, keeping longer numbers possible. */
export function matchPathLinkDigit(
  links: readonly DetectedPathLink[],
  digits: string,
  digit: string,
): PathLinkDigitResult {
  const next = digits + digit
  const matches = links.filter((link) => String(link.index).startsWith(next))
  if (!matches.length) return { digits: "", matches, invalid: true, attempted: next }
  return { digits: next, matches, exact: matches.find((link) => String(link.index) === next), invalid: false }
}

/** Resolves candidates against the session directory and numbers stable links. */
export function detectPathLinks(parts: readonly PathLinkPart[], options: PathLinkOptions): PathLinkDetection {
  const stat = createStatCache()
  const numbers = new Map<string, number>()
  const links: DetectedPathLink[] = []
  const marked = new Map<string, { text: string; markers: PathLinkMarker[] }>()

  for (const part of parts) {
    const markers: PathLinkMarker[] = []
    for (const candidate of scanPathCandidates(part.text)) {
      const resolved = resolveCandidate(candidate.text, options.base, stat)
      if (!resolved) continue
      const key = `${resolved.path}\0${resolved.line ?? ""}\0${resolved.column ?? ""}`
      const existing = numbers.get(key)
      if (existing === undefined) {
        const index = links.length + 1
        numbers.set(key, index)
        links.push({
          index,
          partID: part.id,
          display: candidate.text,
          path: resolved.path,
          line: resolved.line,
          column: resolved.column,
          kind: resolved.kind,
          exists: resolved.exists,
        })
        markers.push({ at: candidate.markerAt, index })
        continue
      }
      markers.push({ at: candidate.markerAt, index: existing })
    }
    if (markers.length) marked.set(part.id, { text: part.text, markers })
  }

  return { links, parts: marked }
}

function scanLine(line: string, offset: number, candidates: PathLinkCandidate[]) {
  const ranges: Array<{ start: number; end: number }> = []
  let index = 0
  while (index < line.length) {
    const char = line[index]!
    if (char === "`") {
      const run = countRun(line, index, "`")
      const close = findRun(line, index + run, "`", run)
      if (close === -1) {
        index += run
        continue
      }
      ranges.push({ start: index, end: close + run })
      index = close + run
      continue
    }
    if (char === "[") {
      const end = readMarkdownLinkEnd(line, index)
      if (end !== undefined) {
        ranges.push({ start: index, end })
        index = end
        continue
      }
    }
    if (char === "<") {
      const close = line.indexOf(">", index + 1)
      if (close !== -1) {
        ranges.push({ start: index, end: close + 1 })
        index = close + 1
        continue
      }
    }
    if (char === "h" && /^https?:\/\//i.test(line.slice(index))) {
      const url = readUrl(line, index)
      if (url) {
        ranges.push({ start: index, end: url })
        index = url
        continue
      }
    }
    index++
  }

  let cursor = 0
  for (const range of [...ranges, { start: line.length, end: line.length }]) {
    if (range.start > cursor) scanBare(line.slice(cursor, range.start), offset + cursor, candidates)
    cursor = Math.max(cursor, range.end)
  }
}

function scanBare(segment: string, offset: number, candidates: PathLinkCandidate[]) {
  for (const match of segment.matchAll(barePattern)) {
    const raw = match[0]
    const start = match.index ?? 0
    const base = trimToken(raw)
    if (!base) continue
    // The path pattern stops before `:12`; keep an attached suffix with the
    // path so its marker lands after the line reference.
    const suffix =
      base === raw
        ? (/^:\d{1,7}(?::\d{1,7})?(?:-\d{1,7}(?::\d{1,7})?)?/.exec(segment.slice(start + raw.length))?.[0] ?? "")
        : ""
    const text = base + suffix
    const candidate = toCandidate(text, offset + start, offset + start + text.length)
    if (candidate) candidates.push(candidate)
  }
}

function toCandidate(text: string, start: number, markerAt: number) {
  const suffix = splitSuffix(text)
  const value = suffix?.path ?? text
  if (!looksLikePath(value)) return
  return { text: suffix ? text : value, start, end: start + text.length, markerAt }
}

function looksLikePath(value: string) {
  if (!value || value.length > 4096) return false
  if (/[<>|]/.test(value)) return false
  if (explicitPattern.test(value)) return true
  if (/\s/.test(value)) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:[^\\/]/.test(value)) return false
  if (/[\\/]/.test(value)) return true
  return /^[^/\\]+\.[A-Za-z0-9]{1,8}$/.test(value)
}

function splitSuffix(value: string) {
  const colon = /^(.+?):(\d{1,7})(?::(\d{1,7}))?(?:-\d{1,7}(?::\d{1,7})?)?$/.exec(value)
  if (colon && !/^[A-Za-z]$/.test(colon[1]!)) {
    const line = Number(colon[2])
    const column = colon[3] ? Number(colon[3]) : undefined
    if (validLine(line) && (column === undefined || validLine(column))) return { path: colon[1]!, line, column }
  }
  return
}

function validLine(value: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_SUFFIX_LINE
}

function countRun(line: string, index: number, char: string) {
  let length = 0
  while (line[index + length] === char) length++
  return length
}

function findRun(line: string, from: number, char: string, length: number) {
  let index = from
  while (index < line.length) {
    if (line[index] !== char) {
      index++
      continue
    }
    const run = countRun(line, index, char)
    if (run === length) return index
    index += run
  }
  return -1
}

function readMarkdownLinkEnd(line: string, open: number) {
  const labelEnd = line.indexOf("]", open + 1)
  if (labelEnd === -1 || line[labelEnd + 1] !== "(") return
  const close = line.indexOf(")", labelEnd + 2)
  if (close === -1) return
  return close + 1
}

function readUrl(line: string, from: number) {
  let index = from
  while (index < line.length && !/[\s<>`"']/.test(line[index]!)) index++
  return index > from ? index : undefined
}

function trimToken(raw: string) {
  let value = raw
  while (value.length) {
    const last = value[value.length - 1]!
    if (".,;:!?".includes(last)) {
      value = value.slice(0, -1)
      continue
    }
    if (last === ")" || last === "]") {
      const open = last === ")" ? "(" : "["
      if (count(value, last) > count(value, open)) {
        value = value.slice(0, -1)
        continue
      }
    }
    break
  }
  return value
}

function count(value: string, char: string) {
  let total = 0
  for (const item of value) if (item === char) total++
  return total
}

type StatCache = Map<string, { exists: boolean; kind?: "file" | "directory" }>

function createStatCache(): StatCache {
  return new Map()
}

function statFile(file: string, cache: StatCache) {
  const cached = cache.get(file)
  if (cached) return cached
  const result = (() => {
    try {
      const stat = statSync(file, { throwIfNoEntry: false })
      if (!stat) return { exists: false }
      return { exists: true, kind: stat.isDirectory() ? ("directory" as const) : ("file" as const) }
    } catch {
      return { exists: false }
    }
  })()
  cache.set(file, result)
  return result
}

function resolveCandidate(raw: string, base: string, cache: StatCache) {
  const suffix = splitSuffix(raw)
  const value = suffix?.path ?? raw
  if (!looksLikePath(value)) return
  const absolute = path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value)
  const stat = statFile(absolute, cache)
  if (!stat.exists && !isExplicit(value)) return
  return {
    path: absolute,
    line: suffix?.line,
    column: suffix?.column,
    kind: stat.kind,
    exists: stat.exists,
  }
}

function isExplicit(value: string) {
  return explicitPattern.test(value)
}
