// hashline autocorrect heuristics in this file are inspired by
// https://github.com/can1357/oh-my-pi (mit license), adapted for opencode.

import z from "zod"

export const HASHLINE_ALPHABET = "ZPMQVRWSNKTXJBYH"

const HASHLINE_ID_LENGTH = 2
const HASHLINE_ID_REGEX = new RegExp(`^[${HASHLINE_ALPHABET}]{${HASHLINE_ID_LENGTH}}$`)
const HASHLINE_REF_REGEX = new RegExp(`(\\d+)#([${HASHLINE_ALPHABET}]{${HASHLINE_ID_LENGTH}})(?=$|\\s|:)`)
const LOW_SIGNAL_CONTENT_RE = /^[^a-zA-Z0-9]+$/

type TextValue = string | string[]

export const HashlineText = z.union([z.string(), z.array(z.string())])

export const HashlineEdit = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("set_line"),
      line: z.string(),
      text: HashlineText,
    })
    .strict(),
  z
    .object({
      type: z.literal("replace_lines"),
      start_line: z.string(),
      end_line: z.string(),
      text: HashlineText,
    })
    .strict(),
  z
    .object({
      type: z.literal("insert_after"),
      line: z.string(),
      text: HashlineText,
    })
    .strict(),
  z
    .object({
      type: z.literal("insert_before"),
      line: z.string(),
      text: HashlineText,
    })
    .strict(),
  z
    .object({
      type: z.literal("insert_between"),
      after_line: z.string(),
      before_line: z.string(),
      text: HashlineText,
    })
    .strict(),
  z
    .object({
      type: z.literal("append"),
      text: HashlineText,
    })
    .strict(),
  z
    .object({
      type: z.literal("prepend"),
      text: HashlineText,
    })
    .strict(),
  z
    .object({
      type: z.literal("replace"),
      old_text: z.string(),
      new_text: HashlineText,
      all: z.boolean().optional(),
    })
    .strict(),
])

export type HashlineEdit = z.infer<typeof HashlineEdit>

function isLowSignalContent(normalized: string) {
  if (normalized.length === 0) return true
  if (normalized.length <= 2) return true
  return LOW_SIGNAL_CONTENT_RE.test(normalized)
}

export function hashlineID(lineNumber: number, line: string): string {
  let normalized = line
  if (normalized.endsWith("\r")) normalized = normalized.slice(0, -1)
  normalized = normalized.replace(/\s+/g, "")
  const seed = isLowSignalContent(normalized) ? `${normalized}:${lineNumber}` : normalized
  const hash = Bun.hash.xxHash32(seed) & 0xff
  const high = (hash >>> 4) & 0x0f
  const low = hash & 0x0f
  return `${HASHLINE_ALPHABET[high]}${HASHLINE_ALPHABET[low]}`
}

export function hashlineRef(lineNumber: number, line: string): string {
  return `${lineNumber}#${hashlineID(lineNumber, line)}`
}

export function hashlineLine(lineNumber: number, line: string): string {
  return `${hashlineRef(lineNumber, line)}:${line}`
}

export function parseHashlineRef(input: string, label: string) {
  const match = input.match(HASHLINE_REF_REGEX)
  if (!match) {
    throw new Error(`${label} must contain a LINE#ID reference`)
  }

  const line = Number.parseInt(match[1], 10)
  if (!Number.isInteger(line) || line < 1) {
    throw new Error(`${label} has invalid line number: ${match[1]}`)
  }

  const id = match[2]
  if (!HASHLINE_ID_REGEX.test(id)) {
    throw new Error(`${label} has invalid hash id: ${id}`)
  }

  return {
    raw: `${line}#${id}`,
    line,
    id,
  }
}

function toLines(text: TextValue) {
  if (Array.isArray(text)) return text
  return text.split(/\r?\n/)
}

const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+#[ZPMQVRWSNKTXJBYH]{2}:/
const WRAPPER_PREFIX_RE = /^\s*(?:>>>|>>)\s?/

function stripByMajority(lines: string[], test: (line: string) => boolean, rewrite: (line: string) => string) {
  const nonEmpty = lines.filter((line) => line.length > 0)
  if (nonEmpty.length === 0) return lines

  const matches = nonEmpty.filter(test).length
  if (matches === 0 || matches < nonEmpty.length * 0.5) return lines

  return lines.map(rewrite)
}

function stripNewLinePrefixes(lines: string[]) {
  const stripped = stripByMajority(
    lines,
    (line) => HASHLINE_PREFIX_RE.test(line),
    (line) => line.replace(HASHLINE_PREFIX_RE, ""),
  )
  return stripByMajority(
    stripped,
    (line) => WRAPPER_PREFIX_RE.test(line),
    (line) => line.replace(WRAPPER_PREFIX_RE, ""),
  )
}

function equalsIgnoringWhitespace(a: string, b: string) {
  if (a === b) return true
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "")
}

function leadingWhitespace(line: string) {
  const match = line.match(/^\s*/)
  if (!match) return ""
  return match[0]
}

function restoreLeadingIndent(template: string, line: string) {
  if (line.length === 0) return line
  const templateIndent = leadingWhitespace(template)
  if (templateIndent.length === 0) return line
  const indent = leadingWhitespace(line)
  if (indent.length > 0) return line
  return templateIndent + line
}

function restoreIndentForPairedReplacement(oldLines: string[], newLines: string[]) {
  if (oldLines.length !== newLines.length) return newLines
  let changed = false
  const out = new Array<string>(newLines.length)
  for (let idx = 0; idx < newLines.length; idx++) {
    const restored = restoreLeadingIndent(oldLines[idx], newLines[idx])
    out[idx] = restored
    if (restored !== newLines[idx]) changed = true
  }
  if (changed) return out
  return newLines
}

function stripAllWhitespace(s: string) {
  return s.replace(/\s+/g, "")
}

function restoreOldWrappedLines(oldLines: string[], newLines: string[]) {
  if (oldLines.length === 0 || newLines.length < 2) return newLines

  const canonToOld = new Map<string, { line: string; count: number }>()
  for (const line of oldLines) {
    const canon = stripAllWhitespace(line)
    const bucket = canonToOld.get(canon)
    if (bucket) bucket.count++
    if (!bucket) canonToOld.set(canon, { line, count: 1 })
  }

  const candidates: Array<{ start: number; len: number; replacement: string; canon: string }> = []
  for (let start = 0; start < newLines.length; start++) {
    for (let len = 2; len <= 10 && start + len <= newLines.length; len++) {
      const canonSpan = stripAllWhitespace(newLines.slice(start, start + len).join(""))
      const old = canonToOld.get(canonSpan)
      if (old && old.count === 1 && canonSpan.length >= 6) {
        candidates.push({
          start,
          len,
          replacement: old.line,
          canon: canonSpan,
        })
      }
    }
  }
  if (candidates.length === 0) return newLines

  const canonCounts = new Map<string, number>()
  for (const candidate of candidates) {
    canonCounts.set(candidate.canon, (canonCounts.get(candidate.canon) ?? 0) + 1)
  }

  const unique = candidates.filter((candidate) => (canonCounts.get(candidate.canon) ?? 0) === 1)
  if (unique.length === 0) return newLines

  unique.sort((a, b) => b.start - a.start)
  const out = [...newLines]
  for (const candidate of unique) {
    out.splice(candidate.start, candidate.len, candidate.replacement)
  }

  return out
}

function stripInsertAnchorEchoAfter(anchorLine: string, lines: string[]) {
  if (lines.length <= 1) return lines
  if (equalsIgnoringWhitespace(lines[0], anchorLine)) return lines.slice(1)
  return lines
}

function stripInsertAnchorEchoBefore(anchorLine: string, lines: string[]) {
  if (lines.length <= 1) return lines
  if (equalsIgnoringWhitespace(lines[lines.length - 1], anchorLine)) return lines.slice(0, -1)
  return lines
}

function stripInsertBoundaryEcho(afterLine: string, beforeLine: string, lines: string[]) {
  let out = lines
  if (out.length > 1 && equalsIgnoringWhitespace(out[0], afterLine)) out = out.slice(1)
  if (out.length > 1 && equalsIgnoringWhitespace(out[out.length - 1], beforeLine)) out = out.slice(0, -1)
  return out
}

function stripRangeBoundaryEcho(fileLines: string[], startLine: number, endLine: number, lines: string[]) {
  const count = endLine - startLine + 1
  if (lines.length <= 1 || lines.length <= count) return lines

  let out = lines
  const beforeIdx = startLine - 2
  if (beforeIdx >= 0 && equalsIgnoringWhitespace(out[0], fileLines[beforeIdx])) {
    out = out.slice(1)
  }

  const afterIdx = endLine
  if (
    afterIdx < fileLines.length &&
    out.length > 0 &&
    equalsIgnoringWhitespace(out[out.length - 1], fileLines[afterIdx])
  ) {
    out = out.slice(0, -1)
  }

  return out
}

function ensureText(text: TextValue, label: string) {
  const value = Array.isArray(text) ? text.join("") : text
  if (value.length > 0) return
  throw new Error(`${label} must be non-empty`)
}

function applyReplace(content: string, oldText: string, newText: TextValue, all = false) {
  if (oldText.length === 0) throw new Error("replace.old_text must be non-empty")

  const next = toLines(newText).join("\n")
  const first = content.indexOf(oldText)
  if (first < 0) throw new Error(`replace.old_text not found: ${JSON.stringify(oldText)}`)

  if (all) return content.replaceAll(oldText, next)

  const last = content.lastIndexOf(oldText)
  if (first !== last) {
    throw new Error("replace.old_text matched multiple times. Set all=true or provide a more specific old_text.")
  }

  return content.slice(0, first) + next + content.slice(first + oldText.length)
}

function mismatchContext(lines: string[], line: number) {
  if (lines.length === 0) return ">>> (file is empty)"
  const start = Math.max(1, line - 1)
  const end = Math.min(lines.length, line + 1)
  return Array.from({ length: end - start + 1 }, (_, idx) => start + idx)
    .map((num) => {
      const marker = num === line ? ">>>" : "   "
      return `${marker} ${hashlineLine(num, lines[num - 1])}`
    })
    .join("\n")
}

function mismatchSummary(lines: string[], mismatch: { expected: string; line: number }) {
  if (mismatch.line < 1 || mismatch.line > lines.length) {
    return `- expected ${mismatch.expected} -> line ${mismatch.line} is out of range (1-${Math.max(lines.length, 1)})`
  }
  return `- expected ${mismatch.expected} -> retry with ${hashlineRef(mismatch.line, lines[mismatch.line - 1])}`
}

function throwMismatch(lines: string[], mismatches: Array<{ expected: string; line: number }>) {
  const seen = new Set<string>()
  const unique = mismatches.filter((mismatch) => {
    const key = `${mismatch.expected}:${mismatch.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const preview = unique.slice(0, 2).map((mismatch) => mismatchSummary(lines, mismatch))
  const hidden = unique.length - preview.length
  const count = unique.length
  const linesOut = [
    `Hashline edit rejected: ${count} anchor mismatch${count === 1 ? "" : "es"}. Re-read the file and retry with the updated anchors below.`,
    ...preview,
    ...(hidden > 0 ? [`- ... and ${hidden} more mismatches`] : []),
  ]

  if (Bun.env.OPENCODE_HL_MISMATCH_DEBUG === "1") {
    const body = unique
      .map((mismatch) => {
        if (mismatch.line < 1 || mismatch.line > lines.length) {
          return [
            `>>> expected ${mismatch.expected}`,
            `>>> current line ${mismatch.line} is out of range (1-${Math.max(lines.length, 1)})`,
          ].join("\n")
        }
        return [
          `>>> expected ${mismatch.expected}`,
          mismatchContext(lines, mismatch.line),
          `>>> retry with ${hashlineRef(mismatch.line, lines[mismatch.line - 1])}`,
        ].join("\n")
      })
      .join("\n\n")
    linesOut.push("", body)
  }

  throw new Error(linesOut.join("\n"))
}

function validateAnchors(lines: string[], refs: Array<{ raw: string; line: number; id: string }>) {
  const mismatches = refs
    .filter((ref) => {
      if (ref.line < 1 || ref.line > lines.length) return true
      return hashlineID(ref.line, lines[ref.line - 1]) !== ref.id
    })
    .map((ref) => ({ expected: ref.raw, line: ref.line }))

  if (mismatches.length > 0) throwMismatch(lines, mismatches)
}

function splitLines(text: string) {
  if (text === "") {
    return {
      lines: [] as string[],
      trailing: false,
    }
  }

  const trailing = text.endsWith("\n")
  const lines = text.split(/\r?\n/)
  if (trailing) lines.pop()

  return { lines, trailing }
}

export function parseHashlineContent(bytes: Buffer) {
  const raw = bytes.toString("utf8")
  let text = raw
  const bom = raw.startsWith("\uFEFF")
  if (bom) text = raw.slice(1)

  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const { lines, trailing } = splitLines(text)

  return {
    bom,
    eol,
    trailing,
    lines,
    text,
    raw,
  }
}

export function serializeHashlineContent(input: { lines: string[]; bom: boolean; eol: string; trailing: boolean }) {
  let text = input.lines.join(input.eol)
  if (input.trailing && input.lines.length > 0) text += input.eol
  if (input.bom) text = `\uFEFF${text}`
  return {
    text,
    bytes: Buffer.from(text, "utf8"),
  }
}

type Splice = {
  start: number
  del: number
  text: string[]
  order: number
  kind: "set_line" | "replace_lines" | "insert_after" | "insert_before" | "insert_between" | "append" | "prepend"
  sortLine: number
  precedence: number
  startLine?: number
  endLine?: number
  anchorLine?: number
  beforeLine?: number
  afterLine?: number
}

export function applyHashlineEdits(input: {
  lines: string[]
  trailing: boolean
  edits: HashlineEdit[]
  autocorrect?: boolean
  aggressiveAutocorrect?: boolean
}) {
  const lines = [...input.lines]
  const originalLines = [...input.lines]
  let trailing = input.trailing
  const refs: Array<{ raw: string; line: number; id: string }> = []
  const replaceOps: Array<Extract<HashlineEdit, { type: "replace" }>> = []
  const ops: Splice[] = []
  const autocorrect = input.autocorrect ?? Bun.env.OPENCODE_HL_AUTOCORRECT === "1"
  const aggressiveAutocorrect = input.aggressiveAutocorrect ?? Bun.env.OPENCODE_HL_AUTOCORRECT === "1"
  const parseText = (text: TextValue) => {
    const next = toLines(text)
    if (!autocorrect) return next
    return stripNewLinePrefixes(next)
  }

  input.edits.forEach((edit, order) => {
    if (edit.type === "replace") {
      replaceOps.push(edit)
      return
    }

    if (edit.type === "append") {
      ensureText(edit.text, "append.text")
      ops.push({
        start: lines.length,
        del: 0,
        text: parseText(edit.text),
        order,
        kind: "append",
        sortLine: lines.length + 1,
        precedence: 1,
      })
      return
    }

    if (edit.type === "prepend") {
      ensureText(edit.text, "prepend.text")
      ops.push({
        start: 0,
        del: 0,
        text: parseText(edit.text),
        order,
        kind: "prepend",
        sortLine: 0,
        precedence: 2,
      })
      return
    }

    if (edit.type === "set_line") {
      const line = parseHashlineRef(edit.line, "set_line.line")
      refs.push(line)
      ops.push({
        start: line.line - 1,
        del: 1,
        text: parseText(edit.text),
        order,
        kind: "set_line",
        sortLine: line.line,
        precedence: 0,
        startLine: line.line,
        endLine: line.line,
      })
      return
    }

    if (edit.type === "replace_lines") {
      const start = parseHashlineRef(edit.start_line, "replace_lines.start_line")
      const end = parseHashlineRef(edit.end_line, "replace_lines.end_line")
      refs.push(start)
      refs.push(end)

      if (start.line > end.line) {
        throw new Error("replace_lines.start_line must be less than or equal to replace_lines.end_line")
      }

      ops.push({
        start: start.line - 1,
        del: end.line - start.line + 1,
        text: parseText(edit.text),
        order,
        kind: "replace_lines",
        sortLine: end.line,
        precedence: 0,
        startLine: start.line,
        endLine: end.line,
      })
      return
    }

    if (edit.type === "insert_after") {
      const line = parseHashlineRef(edit.line, "insert_after.line")
      ensureText(edit.text, "insert_after.text")
      refs.push(line)
      ops.push({
        start: line.line,
        del: 0,
        text: parseText(edit.text),
        order,
        kind: "insert_after",
        sortLine: line.line,
        precedence: 1,
        anchorLine: line.line,
      })
      return
    }

    if (edit.type === "insert_before") {
      const line = parseHashlineRef(edit.line, "insert_before.line")
      ensureText(edit.text, "insert_before.text")
      refs.push(line)
      ops.push({
        start: line.line - 1,
        del: 0,
        text: parseText(edit.text),
        order,
        kind: "insert_before",
        sortLine: line.line,
        precedence: 2,
        anchorLine: line.line,
      })
      return
    }

    const after = parseHashlineRef(edit.after_line, "insert_between.after_line")
    const before = parseHashlineRef(edit.before_line, "insert_between.before_line")
    ensureText(edit.text, "insert_between.text")
    refs.push(after)
    refs.push(before)

    if (after.line >= before.line) {
      throw new Error("insert_between.after_line must be less than insert_between.before_line")
    }

    ops.push({
      start: after.line,
      del: 0,
      text: parseText(edit.text),
      order,
      kind: "insert_between",
      sortLine: before.line,
      precedence: 3,
      afterLine: after.line,
      beforeLine: before.line,
    })
  })

  validateAnchors(lines, refs)

  const sorted = [...ops].sort((a, b) => {
    if (a.sortLine !== b.sortLine) return b.sortLine - a.sortLine
    if (a.precedence !== b.precedence) return a.precedence - b.precedence
    return a.order - b.order
  })

  sorted.forEach((op) => {
    if (op.start < 0 || op.start > lines.length) {
      throw new Error(`line index ${op.start + 1} is out of range`)
    }

    let text = op.text
    if (autocorrect && aggressiveAutocorrect) {
      if (op.kind === "set_line" || op.kind === "replace_lines") {
        const start = op.startLine ?? op.start + 1
        const end = op.endLine ?? start + op.del - 1
        const old = originalLines.slice(start - 1, end)
        text = stripRangeBoundaryEcho(originalLines, start, end, text)
        text = restoreOldWrappedLines(old, text)
        text = restoreIndentForPairedReplacement(old, text)
      }

      if ((op.kind === "insert_after" || op.kind === "append") && op.anchorLine) {
        text = stripInsertAnchorEchoAfter(originalLines[op.anchorLine - 1], text)
      }

      if ((op.kind === "insert_before" || op.kind === "prepend") && op.anchorLine) {
        text = stripInsertAnchorEchoBefore(originalLines[op.anchorLine - 1], text)
      }

      if (op.kind === "insert_between" && op.afterLine && op.beforeLine) {
        text = stripInsertBoundaryEcho(originalLines[op.afterLine - 1], originalLines[op.beforeLine - 1], text)
      }
    }

    lines.splice(op.start, op.del, ...text)
  })

  if (replaceOps.length > 0) {
    const content = `${lines.join("\n")}${trailing && lines.length > 0 ? "\n" : ""}`
    const replaced = replaceOps.reduce(
      (acc, op) =>
        applyReplace(acc, op.old_text, autocorrect ? stripNewLinePrefixes(toLines(op.new_text)) : op.new_text, op.all),
      content,
    )
    const split = splitLines(replaced)
    lines.splice(0, lines.length, ...split.lines)
    trailing = split.trailing
  }

  return {
    lines,
    trailing,
  }
}

export function hashlineOnlyCreates(edits: HashlineEdit[]) {
  return edits.every((edit) => edit.type === "append" || edit.type === "prepend")
}
