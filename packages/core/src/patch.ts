export * as Patch from "./patch"

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

export function parse(patchText: string): ReadonlyArray<Hunk> {
  const lines = stripHeredoc(patchText.trim()).split("\n")
  const begin = lines.findIndex((line) => line.trim() === "*** Begin Patch")
  const end = lines.findIndex((line) => line.trim() === "*** End Patch")
  if (begin === -1 || end === -1 || begin >= end) throw new Error("Invalid patch format: missing Begin/End markers")

  const hunks: Hunk[] = []
  let index = begin + 1
  while (index < end) {
    const line = lines[index]!
    if (line.startsWith("*** Add File:")) {
      const path = line.slice("*** Add File:".length).trim()
      if (!path) throw new Error("Invalid add file path")
      const parsed = parseAdd(lines, index + 1)
      hunks.push({ type: "add", path, contents: parsed.content })
      index = parsed.next
      continue
    }
    if (line.startsWith("*** Delete File:")) {
      const path = line.slice("*** Delete File:".length).trim()
      if (!path) throw new Error("Invalid delete file path")
      hunks.push({ type: "delete", path })
      index++
      continue
    }
    if (line.startsWith("*** Update File:")) {
      const path = line.slice("*** Update File:".length).trim()
      if (!path) throw new Error("Invalid update file path")
      let next = index + 1
      let movePath: string | undefined
      if (lines[next]?.startsWith("*** Move to:")) {
        movePath = lines[next]!.slice("*** Move to:".length).trim()
        if (!movePath) throw new Error("Invalid move file path")
        next++
      }
      const parsed = parseUpdate(lines, next)
      if (parsed.chunks.length === 0) throw new Error(`Invalid update hunk for ${path}: expected at least one @@ chunk`)
      hunks.push({ type: "update", path, movePath, chunks: parsed.chunks })
      index = parsed.next
      continue
    }
    throw new Error(`Invalid patch line: ${line}`)
  }
  return hunks
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

function parseAdd(lines: ReadonlyArray<string>, start: number) {
  const content: string[] = []
  let index = start
  while (index < lines.length && !lines[index]!.startsWith("***")) {
    if (!lines[index]!.startsWith("+")) throw new Error(`Invalid add file line: ${lines[index]}`)
    content.push(lines[index]!.slice(1))
    index++
  }
  return { content: content.join("\n"), next: index }
}

function parseUpdate(lines: ReadonlyArray<string>, start: number) {
  const chunks: UpdateFileChunk[] = []
  let index = start
  while (index < lines.length && !lines[index]!.startsWith("***")) {
    if (!lines[index]!.startsWith("@@")) {
      throw new Error(`Invalid update file line: ${lines[index]}`)
    }
    const changeContext = lines[index]!.slice(2).trim() || undefined
    const oldLines: string[] = []
    const newLines: string[] = []
    let endOfFile = false
    index++
    while (index < lines.length && !lines[index]!.startsWith("@@")) {
      const line = lines[index]!
      if (line === "*** End of File") {
        endOfFile = true
        index++
        break
      }
      if (line.startsWith("***")) break
      if (line.startsWith(" ")) {
        oldLines.push(line.slice(1))
        newLines.push(line.slice(1))
      } else if (line.startsWith("-")) oldLines.push(line.slice(1))
      else if (line.startsWith("+")) newLines.push(line.slice(1))
      else throw new Error(`Invalid update chunk line: ${line}`)
      index++
    }
    chunks.push({ oldLines, newLines, changeContext, endOfFile: endOfFile || undefined })
  }
  return { chunks, next: index }
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
  for (const compare of [exact, rstrip, trim, normalized]) {
    if (eof) {
      const offset = lines.length - pattern.length
      if (offset >= start && matches(lines, pattern, offset, compare)) return offset
    }
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
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
const splitBom = (text: string) =>
  text.startsWith("\uFEFF") ? { bom: true, text: text.slice(1) } : { bom: false, text }
const stripHeredoc = (input: string) =>
  input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/)?.[2] ?? input
