export * as Patch from "./patch.js"

import { Result, Schema } from "effect"

export class BoundaryError extends Schema.TaggedErrorClass<BoundaryError>()("Patch.BoundaryError", {
  boundary: Schema.Literals(["first", "last"]),
}) {
  override get message() {
    return `The ${this.boundary} line of the patch must be '${this.boundary === "first" ? "*** Begin Patch" : "*** End Patch"}'`
  }
}

export class InvalidHunkError extends Schema.TaggedErrorClass<InvalidHunkError>()("Patch.InvalidHunkError", {
  line: Schema.String,
  lineNumber: Schema.Number,
  reason: Schema.optional(Schema.String),
}) {
  override get message() {
    if (this.reason) return `Invalid hunk at line ${this.lineNumber}: ${this.reason}`
    return `Invalid hunk at line ${this.lineNumber}: '${this.line}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`
  }
}

export type ParseError = BoundaryError | InvalidHunkError

export type Hunk =
  | { readonly type: "add"; readonly path: string; readonly contents: string }
  | { readonly type: "delete"; readonly path: string }
  | {
      readonly type: "update"
      readonly path: string
      readonly movePath?: string
      readonly chunks: ReadonlyArray<UpdateFileChunk>
    }

export interface UpdateFileChunk {
  readonly oldLines: ReadonlyArray<string>
  readonly newLines: ReadonlyArray<string>
  readonly changeContext?: string
  readonly endOfFile?: boolean
}

export interface FileUpdate {
  readonly content: string
  readonly bom: boolean
}

export function parse(patchText: string): Result.Result<ReadonlyArray<Hunk>, ParseError> {
  const lines = stripHeredoc(patchText.trim())
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
  const begin = lines[0]?.trim() === "*** Begin Patch" ? 0 : -1
  const end = lines.at(-1)?.trim() === "*** End Patch" ? lines.length - 1 : -1
  if (begin === -1) return Result.fail(new BoundaryError({ boundary: "first" }))
  if (end === -1 || begin >= end) return Result.fail(new BoundaryError({ boundary: "last" }))

  const hunks: Hunk[] = []
  let index = begin + 1
  while (index < end) {
    const line = lines[index]!
    const header = line.trim()
    if (
      index === begin + 1 &&
      header.startsWith("*** Environment ID:") &&
      header.slice("*** Environment ID:".length).trim()
    ) {
      index++
      continue
    }
    if (header.startsWith("*** Add File: ")) {
      const path = header.slice("*** Add File: ".length).trim()
      const parsed = parseAdd(lines, index + 1, end)
      if ("error" in parsed) return Result.fail(parsed.error)
      hunks.push({ type: "add", path, contents: parsed.content })
      index = parsed.next
      continue
    }
    if (header.startsWith("*** Delete File: ")) {
      const path = header.slice("*** Delete File: ".length).trim()
      hunks.push({ type: "delete", path })
      index++
      continue
    }
    if (header.startsWith("*** Update File: ")) {
      const path = header.slice("*** Update File: ".length).trim()
      let next = index + 1
      let movePath: string | undefined
      while (lines[next]?.trimEnd() === "*** End of File") next++
      const move = lines[next]?.trimEnd()
      if (move === "*** Move to:" || move?.startsWith("*** Move to: ")) {
        movePath = move.slice("*** Move to: ".length).trim()
        if (!movePath) {
          return Result.fail(new InvalidHunkError({ line: lines[next]!.trim(), lineNumber: next + 1 }))
        }
        next++
      }
      const parsed = parseUpdate(lines, next, end, path, index)
      if ("error" in parsed) return Result.fail(parsed.error)
      hunks.push({ type: "update", path, movePath, chunks: parsed.chunks })
      index = parsed.next
      continue
    }
    return Result.fail(new InvalidHunkError({ line: header, lineNumber: index + 1 }))
  }
  return Result.succeed(hunks)
}

export function derive(path: string, chunks: ReadonlyArray<UpdateFileChunk>, original: string): FileUpdate {
  const source = splitBom(original)
  const lines = source.text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const replacements = computeReplacements(lines, path, chunks)
  const updated = [...lines]
  for (const [start, remove, insert] of replacements.toReversed()) updated.splice(start, remove, ...insert)
  if (updated.at(-1) !== "") updated.push("")
  const next = splitBom(updated.join("\n"))
  return { content: next.text, bom: source.bom || next.bom }
}

export function joinBom(text: string, bom: boolean) {
  const stripped = splitBom(text).text
  return bom ? `\uFEFF${stripped}` : stripped
}

function parseAdd(
  lines: ReadonlyArray<string>,
  start: number,
  end: number,
): { content: string; next: number } | { error: InvalidHunkError } {
  const content: string[] = []
  let index = start
  while (index < end && !isBoundary(lines[index]!.trim())) {
    if (!lines[index]!.startsWith("+")) {
      return { error: new InvalidHunkError({ line: lines[index]!.trim(), lineNumber: index + 1 }) }
    }
    content.push(lines[index]!.slice(1))
    index++
  }
  return { content: content.join("\n"), next: index }
}

function parseUpdate(
  lines: ReadonlyArray<string>,
  start: number,
  end: number,
  path: string,
  hunk: number,
): { chunks: ReadonlyArray<UpdateFileChunk>; next: number } | { error: InvalidHunkError } {
  const chunks: Array<{
    oldLines: string[]
    newLines: string[]
    changeContext?: string
    endOfFile?: boolean
  }> = []
  let index = start
  let afterEndOfFile = false
  while (index < end) {
    const line = lines[index]!
    const updateLine = line.trimEnd()
    if (afterEndOfFile) {
      if (updateLine === "") {
        index++
        continue
      }
      if (updateLine === "@@" || updateLine.startsWith("@@ ")) afterEndOfFile = false
      else if (isBoundary(updateLine)) break
      else {
        return {
          error: new InvalidHunkError({
            line,
            lineNumber: index + 1,
            reason: `Expected update hunk to start with a @@ context marker, got: '${line}'`,
          }),
        }
      }
    }
    if (updateLine === "*** End of File") {
      const chunk = chunks.at(-1)
      if (chunk && chunk.oldLines.length === 0 && chunk.newLines.length === 0) {
        return {
          error: new InvalidHunkError({
            line: updateLine,
            lineNumber: index + 1,
            reason: "Update hunk does not contain any lines",
          }),
        }
      }
      if (chunk) {
        chunk.endOfFile = true
        afterEndOfFile = true
      }
      index++
      continue
    }
    if (isBoundary(updateLine)) break
    if (updateLine === "@@" || updateLine.startsWith("@@ ")) {
      const previous = chunks.at(-1)
      if (previous && previous.oldLines.length === 0 && previous.newLines.length === 0) {
        return {
          error: new InvalidHunkError({
            line,
            lineNumber: index + 1,
            reason: `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
          }),
        }
      }
      chunks.push({
        oldLines: [],
        newLines: [],
        changeContext: updateLine === "@@" ? undefined : updateLine.slice("@@ ".length),
      })
      index++
      continue
    }
    if (chunks.length === 0) chunks.push({ oldLines: [], newLines: [] })
    const chunk = chunks.at(-1)!
    if (line === "") {
      chunk.oldLines.push("")
      chunk.newLines.push("")
      index++
      continue
    }
    if (line.startsWith(" ")) {
      chunk.oldLines.push(line.slice(1))
      chunk.newLines.push(line.slice(1))
      index++
      continue
    }
    if (line.startsWith("-")) {
      chunk.oldLines.push(line.slice(1))
      index++
      continue
    }
    if (line.startsWith("+")) {
      chunk.newLines.push(line.slice(1))
      index++
      continue
    }
    const populated = chunk.oldLines.length > 0 || chunk.newLines.length > 0
    return {
      error: new InvalidHunkError({
        line,
        lineNumber: index + 1,
        reason: populated
          ? `Expected update hunk to start with a @@ context marker, got: '${line}'`
          : `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
      }),
    }
  }
  if (chunks.length === 0) {
    return {
      error: new InvalidHunkError({
        line: lines[hunk]!.trim(),
        lineNumber: hunk + 1,
        reason: `Update file hunk for path '${path}' is empty`,
      }),
    }
  }
  const last = chunks.at(-1)!
  if (last.oldLines.length === 0 && last.newLines.length === 0) {
    const line = lines[index]!.trim()
    return {
      error: new InvalidHunkError({
        line,
        lineNumber: index + 1,
        reason:
          line === "*** End Patch"
            ? "Update hunk does not contain any lines"
            : `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
      }),
    }
  }
  return { chunks, next: index }
}

function isBoundary(line: string) {
  return (
    line === "*** End Patch" ||
    line.startsWith("*** Add File: ") ||
    line.startsWith("*** Delete File: ") ||
    line.startsWith("*** Update File: ")
  )
}

function computeReplacements(lines: ReadonlyArray<string>, path: string, chunks: ReadonlyArray<UpdateFileChunk>) {
  const replacements: Array<readonly [start: number, remove: number, insert: ReadonlyArray<string>]> = []
  let lineIndex = 0
  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const context = seek(lines, [chunk.changeContext], lineIndex)
      if (context === -1) throw new Error(`Failed to find context '${chunk.changeContext}' in ${path}`)
      lineIndex = context + 1
    }
    if (chunk.oldLines.length === 0) {
      replacements.push([lines.length, 0, chunk.newLines])
      continue
    }
    let oldLines = chunk.oldLines
    let newLines = chunk.newLines
    let found = seek(lines, oldLines, lineIndex, chunk.endOfFile)
    if (found === -1 && oldLines.at(-1) === "") {
      oldLines = oldLines.slice(0, -1)
      if (newLines.at(-1) === "") newLines = newLines.slice(0, -1)
      found = seek(lines, oldLines, lineIndex, chunk.endOfFile)
    }
    if (found === -1) throw new Error(`Failed to find expected lines in ${path}:\n${chunk.oldLines.join("\n")}`)
    replacements.push([found, oldLines.length, newLines])
    lineIndex = found + oldLines.length
  }
  return replacements.toSorted((left, right) => left[0] - right[0])
}

function seek(lines: ReadonlyArray<string>, pattern: ReadonlyArray<string>, start: number, eof = false) {
  if (pattern.length === 0) return -1
  if (eof) {
    const offset = lines.length - pattern.length
    if (offset < start) return -1
    for (const compare of [exact, rstrip, trim, normalized]) {
      if (matches(lines, pattern, offset, compare)) return offset
    }
    return -1
  }
  for (const compare of [exact, rstrip, trim, normalized]) {
    for (let offset = start; offset <= lines.length - pattern.length; offset++) {
      if (matches(lines, pattern, offset, compare)) return offset
    }
  }
  return -1
}

function matches(
  lines: ReadonlyArray<string>,
  pattern: ReadonlyArray<string>,
  offset: number,
  compare: (left: string, right: string) => boolean,
) {
  return pattern.every((line, index) => compare(lines[offset + index]!, line))
}

const exact = (left: string, right: string) => left === right
const rstrip = (left: string, right: string) => left.trimEnd() === right.trimEnd()
const trim = (left: string, right: string) => left.trim() === right.trim()
const normalized = (left: string, right: string) => normalize(left.trim()) === normalize(right.trim())
const normalize = (value: string) =>
  value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
const splitBom = (text: string) =>
  text.startsWith("\uFEFF") ? { bom: true, text: text.slice(1) } : { bom: false, text }
const stripHeredoc = (input: string) => input.match(/^(?:cat\s+)?<<(['"]?)(\w+)\1\s*\n([\s\S]*?)\n\2\s*$/)?.[3] ?? input
