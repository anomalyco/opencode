import type { FileContent } from "@/runtime/server/types"
import { Schema, Struct } from "effect"
import { Persistence } from "@/runtime/persistence/schema"

export const FileSelection = Schema.Struct({
  startLine: Schema.Number,
  startChar: Schema.Number,
  endLine: Schema.Number,
  endChar: Schema.Number,
}).mapFields(Struct.map(Schema.mutableKey))
export type FileSelection = typeof FileSelection.Type

export const SelectedLineRange = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  side: Schema.optional(
    Persistence.defaulted(Schema.UndefinedOr(Schema.Literals(["additions", "deletions"])), () => undefined),
  ),
  endSide: Schema.optional(
    Persistence.defaulted(Schema.UndefinedOr(Schema.Literals(["additions", "deletions"])), () => undefined),
  ),
}).mapFields(Struct.map(Schema.mutableKey))
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
