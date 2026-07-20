export * as ToolStructured from "./structured"

import { formatPatch, parsePatch } from "diff"
import { ToolOutputStore } from "../tool-output-store"

export function fit<A>(project: (maxStringBytes: number) => A) {
  const full = project(ToolOutputStore.MAX_STRUCTURED_BYTES)
  if (Buffer.byteLength(JSON.stringify(full), "utf-8") <= ToolOutputStore.MAX_STRUCTURED_BYTES) return full

  let minimum = 0
  let maximum = ToolOutputStore.MAX_STRUCTURED_BYTES
  let result = project(0)
  while (minimum <= maximum) {
    const middle = Math.floor((minimum + maximum) / 2)
    const candidate = project(middle)
    if (Buffer.byteLength(JSON.stringify(candidate), "utf-8") <= ToolOutputStore.MAX_STRUCTURED_BYTES) {
      result = candidate
      minimum = middle + 1
      continue
    }
    maximum = middle - 1
  }
  return result
}

export function truncate(input: string, maximumBytes: number) {
  if (Buffer.byteLength(input, "utf-8") <= maximumBytes) return input
  const marker = " ... truncated ..."
  const markerBytes = Buffer.byteLength(marker, "utf-8")
  const available = Math.max(0, maximumBytes - markerBytes)
  let bytes = 0
  let end = 0
  for (const char of input) {
    const size = Buffer.byteLength(char, "utf-8")
    if (bytes + size > available) break
    bytes += size
    end += char.length
  }
  return input.slice(0, end).replace(/\r?\n$/, "") + (maximumBytes >= markerBytes ? marker : "")
}

export function patch(input: string, maximumBytes: number) {
  if (Buffer.byteLength(input, "utf-8") <= maximumBytes) return input
  const parsed = parsePatch(input)[0]
  const hunk = parsed?.hunks[0]
  if (!parsed || !hunk) return truncate(input, maximumBytes)
  const changedLines = parsed.hunks.flatMap((item) => item.lines).filter((line) => /^[+-]/.test(line))
  const removed = changedLines.filter((line) => line.startsWith("-"))
  const added = changedLines.filter((line) => line.startsWith("+"))
  const changed = [removed[0], added[0]]
    .filter((line) => line !== undefined)
    .map((line) => line[0] + truncate(line.slice(1), Math.max(0, Math.floor(maximumBytes / 2) - 1)))
  const lines = [
    ...changed,
    ...(removed.length > 1 ? [`-... ${removed.length - 1} removed lines omitted ...`] : []),
    ...(added.length > 1 ? [`+... ${added.length - 1} added lines omitted ...`] : []),
  ]
  return formatPatch({
    ...parsed,
    hunks: [
      {
        oldStart: hunk.oldStart,
        oldLines: lines.filter((line) => line.startsWith("-") || line.startsWith(" ")).length,
        newStart: hunk.newStart,
        newLines: lines.filter((line) => line.startsWith("+") || line.startsWith(" ")).length,
        lines,
      },
    ],
  })
}
