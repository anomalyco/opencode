import type { FileContent } from "@opencode/plugin/gui"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"

export const FileSelection = Persistence.struct({
  startLine: Schema.Number,
  startChar: Schema.Number,
  endLine: Schema.Number,
  endChar: Schema.Number,
})

export type FileSelection = typeof FileSelection.Type

export const SelectedLineRange = Persistence.struct({
  start: Schema.Number,
  end: Schema.Number,
  side: Persistence.optional(Schema.Literals(["additions", "deletions"])),
  endSide: Persistence.optional(Schema.Literals(["additions", "deletions"])),
})

export type SelectedLineRange = typeof SelectedLineRange.Type

export type FileViewState = {
  scrollTop?: number
  scrollLeft?: number
  selectedLines?: SelectedLineRange | null
}

type FileStateBase = { readonly path: string; readonly name: string }

// The view `selectFileState` projects from the content machine. Each status fixes the plugin SDK's flags, so loaded
// content never comes with an error and a missing file never shows as loading.
export type FileState =
  | (FileStateBase & {
      readonly status: "loading"
      readonly loaded: false
      readonly loading: true
      readonly notFound: false
      readonly content?: never
      readonly error?: never
    })
  | (FileStateBase & {
      readonly status: "ready"
      readonly loaded: true
      readonly loading: false
      readonly notFound: false
      readonly content: FileContent
      readonly error?: never
    })
  | (FileStateBase & {
      readonly status: "refreshing"
      readonly loaded: true
      readonly loading: true
      readonly notFound: false
      readonly content: FileContent
      readonly error?: never
    })
  | (FileStateBase & {
      readonly status: "missing"
      readonly loaded: false
      readonly loading: false
      readonly notFound: true
      readonly content?: never
      readonly error: string
    })
  | (FileStateBase & {
      readonly status: "error"
      readonly loaded: false
      readonly loading: false
      readonly notFound: false
      readonly content?: never
      readonly error: string
    })

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
