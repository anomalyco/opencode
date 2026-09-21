import type { FileContent } from "@/runtime/server/types"
import { Codec } from "@/runtime/persistence/codec"

export const FileSelection = Codec.struct({
  startLine: Codec.number,
  startChar: Codec.number,
  endLine: Codec.number,
  endChar: Codec.number,
})
export type FileSelection = typeof FileSelection.Type

export const SelectedLineRange = Codec.struct({
  start: Codec.number,
  end: Codec.number,
  side: Codec.lenientOptional(Codec.literals(["additions", "deletions"])),
  endSide: Codec.lenientOptional(Codec.literals(["additions", "deletions"])),
})
export type SelectedLineRange = typeof SelectedLineRange.Type

export type FileViewState = {
  scrollTop?: number
  scrollLeft?: number
  selectedLines?: SelectedLineRange | null
}

export type FileState = {
  path: string
  name: string
  loaded?: boolean
  loading?: boolean
  notFound?: boolean
  error?: string
  content?: FileContent
}

export function selectionFromLines(range: SelectedLineRange): FileSelection {
  const startLine = Math.min(range.start, range.end)
  const endLine = Math.max(range.start, range.end)
  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}

