export * as VcsPatch from "./patch"

import { formatPatch, structuredPatch } from "diff"

// Effectively "full file" context; adapters use it when no context is requested.
export const PATCH_CONTEXT_LINES = 2_147_483_647
export const MAX_PATCH_BYTES = 10_000_000
export const MAX_TOTAL_PATCH_BYTES = 10_000_000

export interface Patch {
  readonly text: string
  readonly truncated: boolean
}

export const emptyPatch = (file: string) => formatPatch(structuredPatch(file, file, "", "", "", "", { context: 0 }))

export const addPatch = (file: string, content: string) =>
  formatPatch(structuredPatch(file, file, "", content, "", "", { context: 0 }))

export const deletePatch = (file: string, content: string) =>
  formatPatch(structuredPatch(file, file, content, "", "", "", { context: 0 }))

/** Count changed lines in a unified diff, ignoring `+++`/`---` file headers. */
export const countPatch = (patch: string) => {
  let additions = 0
  let deletions = 0
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++
  }
  return { additions, deletions }
}

const parseQuotedPath = (value: string) => {
  let out = ""
  for (let idx = 1; idx < value.length; idx++) {
    const char = value[idx]
    if (char === '"') return { value: out, end: idx + 1 }
    if (char !== "\\") {
      out += char
      continue
    }

    const next = value[++idx]
    if (next === "t") out += "\t"
    else if (next === "n") out += "\n"
    else if (next === "r") out += "\r"
    else if (next === '"' || next === "\\") out += next
    else out += next ?? ""
  }
}

const parsePathToken = (value: string) => {
  if (!value.startsWith('"')) return value.split("\t")[0]
  return parseQuotedPath(value)?.value ?? value
}

const fileFromDiffPath = (value: string | undefined) => {
  if (!value || value === "/dev/null") return
  const file = parsePathToken(value)
  if (file.startsWith("a/") || file.startsWith("b/")) return file.slice(2)
  return file
}

const fileFromGitHeader = (header: string) => {
  if (header.startsWith('"')) {
    const first = parseQuotedPath(header)
    const second = first ? header.slice(first.end).trimStart() : undefined
    if (!second) return
    if (!second.startsWith('"')) return fileFromDiffPath(second)
    return fileFromDiffPath(parseQuotedPath(second)?.value)
  }

  const separator = header.indexOf(" b/")
  if (separator === -1) return
  return fileFromDiffPath(header.slice(separator + 1))
}

export const fileFromPatchChunk = (chunk: string) => {
  const next = /^\+\+\+ (.+)$/m.exec(chunk)?.[1]
  const before = /^--- (.+)$/m.exec(chunk)?.[1]
  const file = fileFromDiffPath(next) ?? fileFromDiffPath(before)
  if (file) return file

  const header = /^diff --git (.+)$/m.exec(chunk)?.[1]
  return fileFromGitHeader(header ?? "")
}

/** Split `git diff`-format output into per-file chunks, dropping a trailing partial chunk when truncated. */
export const splitGitPatch = (patch: Patch) => {
  const starts = [...patch.text.matchAll(/(?:^|\n)diff --git /g)].map((match) =>
    match[0].startsWith("\n") ? match.index + 1 : match.index,
  )
  const chunks = starts.map((start, index) => patch.text.slice(start, starts[index + 1] ?? patch.text.length))
  if (!patch.truncated) return chunks
  return chunks.slice(0, -1)
}

/** Map per-file chunks by the file they touch, concatenating chunks for the same file. */
export const chunksByFile = (patch: Patch, fallback: (index: number) => string | undefined) =>
  splitGitPatch(patch).reduce((acc, chunk, index) => {
    const file = fileFromPatchChunk(chunk) ?? fallback(index)
    if (!file) return acc
    acc.set(file, (acc.get(file) ?? "") + chunk)
    return acc
  }, new Map<string, string>())
