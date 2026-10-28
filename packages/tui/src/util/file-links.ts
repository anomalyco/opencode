import { statSync } from "node:fs"
import path from "node:path"

export type PathLinkSource = "bare" | "inline-code" | "markdown-link" | "quoted"

export type PathLinkCandidate = {
  text: string
  start: number
  end: number
  markerAt: number
  source: PathLinkSource
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
  home: string
  platform?: NodeJS.Platform
}

const MAX_SUFFIX_LINE = 1_000_000

const fencePattern = /^ {0,3}(`{3,}|~{3,})/

const barePattern =
  /(?<![\w@.:/\\-])(?:(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\.{1,2}[\\/]|\/)[^\s`"'<>|]*|[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)+|[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9._-]+[\\/])(?![\w/\\])/g

const explicitPattern = /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/]|file:)/i

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

// `~~` conceals in rendered Markdown, so a tag paints only while the picker's
// syntax style maps that scope to the tag color.
export function pathLinkTag(index: number) {
  return `~~${index}~~`
}

export function pathLinkSelectionTag(index: number, selected: boolean) {
  return `~~${selected ? "●" : "○"}${index}~~`
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

/** Toggles one link in a multi-select set without growing past `limit`. */
export function togglePathLinkSelection(selected: ReadonlySet<number>, index: number, limit: number) {
  if (selected.has(index)) {
    const next = new Set(selected)
    next.delete(index)
    return { selected: next, capped: false }
  }
  if (selected.size >= limit) return { selected, capped: true }
  return { selected: new Set(selected).add(index), capped: false }
}

/** Resolves candidates against the session directory and numbers stable links. */
export function detectPathLinks(parts: readonly PathLinkPart[], options: PathLinkOptions): PathLinkDetection {
  const platform = options.platform ?? process.platform
  const stat = createStatCache()
  const numbers = new Map<string, number>()
  const links: DetectedPathLink[] = []
  const marked = new Map<string, { text: string; markers: PathLinkMarker[] }>()

  for (const part of parts) {
    const markers: PathLinkMarker[] = []
    for (const candidate of scanPathCandidates(part.text)) {
      const resolved = resolveCandidate(candidate.text, candidate.source, options.base, options.home, platform, stat)
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
      const contentStart = index + run
      const content = line.slice(contentStart, close)
      const trimmedStart = contentStart + content.length - content.trimStart().length
      const trimmed = content.trim()
      if (trimmed) {
        const candidate = toCandidate(trimmed, offset + trimmedStart, offset + close + run, "inline-code")
        if (candidate) candidates.push(candidate)
      }
      ranges.push({ start: index, end: close + run })
      index = close + run
      continue
    }
    if (char === "[") {
      const link = readMarkdownLink(line, index)
      if (link) {
        ranges.push({ start: index, end: link.end })
        if (link.target) {
          const targetStart = link.targetStart
          const candidate = toCandidate(link.target, offset + targetStart, offset + link.end, "markdown-link")
          if (candidate) candidates.push(candidate)
        }
        index = link.end
        continue
      }
    }
    if (char === "<") {
      const close = line.indexOf(">", index + 1)
      if (close !== -1) {
        const content = line.slice(index + 1, close)
        if (/^file:/i.test(content)) {
          const candidate = toCandidate(content, offset + index + 1, offset + close + 1, "markdown-link")
          if (candidate) candidates.push(candidate)
        }
        ranges.push({ start: index, end: close + 1 })
        index = close + 1
        continue
      }
    }
    if (char === '"' || char === "'") {
      const before = index === 0 ? " " : line[index - 1]!
      if (!/[\w]/.test(before)) {
        const close = line.indexOf(char, index + 1)
        if (close !== -1) {
          const start = index + 1
          const content = line.slice(start, close).trim()
          if (content) {
            const candidate = toCandidate(content, offset + start, offset + close + 1, "quoted")
            if (candidate) candidates.push(candidate)
          }
          ranges.push({ start: index, end: close + 1 })
          index = close + 1
          continue
        }
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
    // The path pattern stops before `:12` and `#L12`; keep an attached suffix
    // with the path so its marker lands after the line reference.
    const suffix =
      base === raw
        ? (/^(?::\d{1,7}(?::\d{1,7})?(?:-\d{1,7}(?::\d{1,7})?)?|#L\d{1,7}(?:C\d{1,7})?(?:-L?\d{1,7}(?:C\d{1,7})?)?)/i.exec(
            segment.slice(start + raw.length),
          )?.[0] ?? "")
        : ""
    const text = base + suffix
    const candidate = toCandidate(text, offset + start, offset + start + text.length, "bare")
    if (candidate) candidates.push(candidate)
  }
}

function toCandidate(text: string, start: number, markerAt: number, source: PathLinkSource) {
  const suffix = splitSuffix(text)
  const value = suffix?.path ?? text
  if (!looksLikePath(value, source !== "bare")) return
  return { text: suffix ? text : value, start, end: start + text.length, markerAt, source }
}

function looksLikePath(value: string, allowSpaces = false) {
  if (!value || value.length > 4096) return false
  if (value.startsWith("file:")) return /^file:\/\//i.test(value)
  if (/[<>|]/.test(value)) return false
  if (explicitPattern.test(value)) return true
  if (/\s/.test(value)) {
    if (!allowSpaces) return false
    return /[\\/]/.test(value) || /\.[A-Za-z0-9]{1,8}$/.test(value)
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:[^\\/]/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)) return false
  if (/[\\/]/.test(value)) return true
  return /^[^/\\]+\.[A-Za-z0-9]{1,8}$/.test(value)
}

function splitSuffix(value: string) {
  const hash = /^(.+?)#L(\d{1,7})(?:C(\d{1,7}))?(?:-L?\d+(?:C\d+)?)?$/i.exec(value)
  if (hash) {
    const line = Number(hash[2])
    const column = hash[3] ? Number(hash[3]) : undefined
    if (validLine(line) && (column === undefined || validLine(column))) return { path: hash[1]!, line, column }
  }
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

function readMarkdownLink(line: string, open: number) {
  const labelEnd = line.indexOf("]", open + 1)
  if (labelEnd === -1 || line[labelEnd + 1] !== "(") return
  const targetOpen = labelEnd + 2
  let index = targetOpen
  let depth = 1
  while (index < line.length) {
    const char = line[index]!
    if (char === "(") depth++
    if (char === ")") {
      depth--
      if (depth === 0) break
    }
    index++
  }
  if (depth !== 0) return
  const inner = line.slice(targetOpen, index)
  const match = /^\s*(<[^>]*>|[^\s]+)/.exec(inner)
  if (!match) return { end: index + 1 }
  const bare = match[1]!
  const target = bare.startsWith("<") ? bare.slice(1, -1) : bare
  const targetStart = targetOpen + inner.indexOf(bare) + (bare.startsWith("<") ? 1 : 0)
  const path = splitSuffix(target)?.path ?? target
  if (!looksLikePath(path) || path.startsWith("#")) return { end: index + 1 }
  return { end: index + 1, target, targetStart }
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

function resolveCandidate(
  raw: string,
  source: PathLinkSource,
  base: string,
  home: string,
  platform: NodeJS.Platform,
  cache: StatCache,
) {
  const suffix = splitSuffix(raw)
  const value = suffix?.path ?? raw
  const fileUrl = resolveFileUrl(value, platform)
  if (fileUrl) {
    const stat = statFile(fileUrl.path, cache)
    return {
      path: fileUrl.path,
      line: fileUrl.line ?? suffix?.line,
      column: fileUrl.column ?? suffix?.column,
      kind: stat.kind,
      exists: stat.exists,
    }
  }
  // A file: URL we cannot resolve is remote or malformed; never treat it as a
  // relative path.
  if (/^file:/i.test(value)) return
  const candidate = expandHome(value, home, platform)
  if (!looksLikePath(candidate, source !== "bare")) return
  const impl = platform === "win32" ? path.win32 : path.posix
  const absolute = impl.isAbsolute(candidate) ? impl.normalize(candidate) : impl.resolve(base, candidate)
  const stat = statFile(absolute, cache)
  if (!stat.exists && !isExplicit(candidate)) return
  return {
    path: absolute,
    line: suffix?.line,
    column: suffix?.column,
    kind: stat.kind,
    exists: stat.exists,
  }
}

function resolveFileUrl(value: string, platform: NodeJS.Platform) {
  if (!/^file:/i.test(value)) return
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return
  }
  if (url.protocol !== "file:") return
  if (platform !== "win32" && url.hostname && url.hostname !== "localhost") return
  let decoded: string
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    return
  }
  const hash = /^#L(\d+)(?:C(\d+))?/i.exec(url.hash)
  const line = hash ? Number(hash[1]) : undefined
  const column = hash?.[2] ? Number(hash[2]) : undefined
  const windows = /^\/[A-Za-z]:/.test(decoded)
  const withoutRoot = platform === "win32" && windows ? decoded.slice(1) : decoded
  if (platform === "win32") {
    if (url.hostname && url.hostname !== "localhost") {
      return {
        path: `\\\\${url.hostname}${decoded.replaceAll("/", "\\")}`,
        line: line !== undefined && validLine(line) ? line : undefined,
        column: column !== undefined && validLine(column) ? column : undefined,
      }
    }
    return {
      path: withoutRoot.replaceAll("/", "\\"),
      line: line !== undefined && validLine(line) ? line : undefined,
      column: column !== undefined && validLine(column) ? column : undefined,
    }
  }
  return {
    path: decoded,
    line: line !== undefined && validLine(line) ? line : undefined,
    column: column !== undefined && validLine(column) ? column : undefined,
  }
}

function expandHome(value: string, home: string, platform: NodeJS.Platform) {
  if (!/^~[\\/]/.test(value)) return value
  const impl = platform === "win32" ? path.win32 : path.posix
  return impl.join(home, value.slice(2))
}

function isExplicit(value: string) {
  return explicitPattern.test(value)
}
