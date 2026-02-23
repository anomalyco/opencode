import { selectionFromLines, type SelectedLineRange } from "@/context/file"
import type { FileAttachmentPart } from "@/context/prompt"

const bounds = (range: SelectedLineRange) => {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  return { start, end }
}

const relative = (path: string, dir: string) => {
  if (!dir || path === dir) return path
  const prefix = dir.endsWith("/") ? dir : dir + "/"
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export const createSelectionPart = (path: string, range: SelectedLineRange, dir: string): FileAttachmentPart => {
  const line = bounds(range)
  return {
    type: "file",
    path,
    selection: selectionFromLines(range),
    content: `@${relative(path, dir)}:${line.start}-${line.end}`,
    start: 0,
    end: 0,
  }
}
