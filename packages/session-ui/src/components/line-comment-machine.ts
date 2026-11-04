import type { SelectedLineRange } from "@pierre/diffs"
import { cloneSelectedLineRange } from "../pierre/selection-bridge"

/** What one file's line comments are doing. A new comment's draft and a saved comment's edit live in different variants, so one never overwrites the other. */
export type LineCommentMode =
  | { readonly status: "idle" }
  | { readonly status: "selecting"; readonly range: SelectedLineRange }
  | { readonly status: "drafting"; readonly range: SelectedLineRange; readonly text: string }
  | { readonly status: "viewing"; readonly id: string; readonly range: SelectedLineRange }
  | { readonly status: "editing"; readonly id: string; readonly range: SelectedLineRange; readonly text: string }

export type LineCommentEvent =
  | { readonly type: "line.selected"; readonly range: SelectedLineRange | null }
  | { readonly type: "line.selection-ended"; readonly range: SelectedLineRange | null }
  | { readonly type: "draft.opened"; readonly range: SelectedLineRange }
  | { readonly type: "draft.changed"; readonly text: string }
  | { readonly type: "draft.cancelled" }
  | { readonly type: "draft.submitted"; readonly text: string }
  | { readonly type: "comment.hovered"; readonly range: SelectedLineRange }
  | { readonly type: "comment.toggled"; readonly id: string; readonly range: SelectedLineRange }
  | { readonly type: "comment.focused"; readonly id: string; readonly range: SelectedLineRange }
  | { readonly type: "comment.deleted"; readonly id: string }
  | { readonly type: "edit.opened"; readonly id: string; readonly range: SelectedLineRange; readonly text: string }
  | { readonly type: "edit.changed"; readonly text: string }
  | { readonly type: "edit.cancelled" }
  | { readonly type: "edit.submitted"; readonly text: string }
  | { readonly type: "passive.cleared" }
  | { readonly type: "reset" }

export type LineCommentEffect =
  | { readonly type: "sync-selected"; readonly range: SelectedLineRange | null }
  | { readonly type: "submit-draft"; readonly comment: string; readonly selection: SelectedLineRange }
  | {
      readonly type: "submit-edit"
      readonly id: string
      readonly comment: string
      readonly selection: SelectedLineRange
    }
  | { readonly type: "delete-comment"; readonly id: string }

export type LineCommentTransition = {
  readonly state: LineCommentMode
  readonly effects: readonly LineCommentEffect[]
}

/** The modes of every file in a multi-file review. Idle files have no entry. */
export type ReviewCommentModes = Readonly<Record<string, ActiveLineCommentMode>>

type ActiveLineCommentMode = Exclude<LineCommentMode, { status: "idle" }>

export const IDLE_LINE_COMMENT_MODE: LineCommentMode = Object.freeze({ status: "idle" })

export const EMPTY_REVIEW_COMMENT_MODES: ReviewCommentModes = Object.freeze({})

const NO_EFFECTS: readonly LineCommentEffect[] = Object.freeze([])

export function transitionLineComment(state: LineCommentMode, event: LineCommentEvent): LineCommentTransition {
  switch (event.type) {
    case "line.selected":
      if (!event.range) return clear(state)

      if (state.status === "editing") return stay(state)

      if ((state.status === "drafting" || state.status === "selecting") && sameSelectedRange(state.range, event.range))
        return stay(state)

      if (state.status === "drafting")
        return enter({ status: "drafting", range: cloneSelectedLineRange(event.range), text: state.text })

      return enter({ status: "selecting", range: cloneSelectedLineRange(event.range) })
    case "line.selection-ended":
      if (!event.range) return clear(state)

      return openDraft(state, event.range)
    case "draft.opened":
      return openDraft(state, event.range)
    case "draft.changed":
      if (state.status !== "drafting" || state.text === event.text) return stay(state)

      return { state: { ...state, text: event.text }, effects: NO_EFFECTS }
    case "draft.cancelled":
      if (state.status !== "drafting") return stay(state)

      return enter(IDLE_LINE_COMMENT_MODE)
    case "draft.submitted": {
      const comment = event.text.trim()

      if (state.status !== "drafting" || !comment) return stay(state)

      return enter(IDLE_LINE_COMMENT_MODE, {
        type: "submit-draft",
        comment,
        selection: cloneSelectedLineRange(state.range),
      })
    }

    case "comment.hovered":
      if (state.status !== "idle" && state.status !== "selecting") return stay(state)

      if (state.status === "selecting" && sameSelectedRange(state.range, event.range)) return stay(state)

      return enter({ status: "selecting", range: cloneSelectedLineRange(event.range) })
    case "comment.toggled":
      if (holdsText(state)) return stay(state)

      if (state.status === "viewing" && state.id === event.id) return enter(IDLE_LINE_COMMENT_MODE)

      return enter({ status: "viewing", id: event.id, range: cloneSelectedLineRange(event.range) })
    case "comment.focused":
      if (holdsText(state)) return stay(state)

      if (state.status === "viewing" && state.id === event.id && sameSelectedRange(state.range, event.range))
        return stay(state)

      return enter({ status: "viewing", id: event.id, range: cloneSelectedLineRange(event.range) })
    case "comment.deleted": {
      const effect: LineCommentEffect = { type: "delete-comment", id: event.id }

      if ((state.status === "viewing" || state.status === "editing") && state.id === event.id)
        return enter(IDLE_LINE_COMMENT_MODE, effect)

      return { state, effects: [effect] }
    }

    case "edit.opened":
      if (holdsText(state)) return stay(state)

      return enter({ status: "editing", id: event.id, range: cloneSelectedLineRange(event.range), text: event.text })
    case "edit.changed":
      if (state.status !== "editing" || state.text === event.text) return stay(state)

      return { state: { ...state, text: event.text }, effects: NO_EFFECTS }
    case "edit.cancelled":
      if (state.status !== "editing") return stay(state)

      return enter(IDLE_LINE_COMMENT_MODE)
    case "edit.submitted": {
      const comment = event.text.trim()

      if (state.status !== "editing" || !comment) return stay(state)

      return enter(IDLE_LINE_COMMENT_MODE, {
        type: "submit-edit",
        id: state.id,
        comment,
        selection: cloneSelectedLineRange(state.range),
      })
    }

    case "passive.cleared":
      if (state.status !== "selecting" && state.status !== "viewing") return stay(state)

      return { state: IDLE_LINE_COMMENT_MODE, effects: NO_EFFECTS }
    case "reset":
      if (state.status === "idle") return stay(state)

      return { state: IDLE_LINE_COMMENT_MODE, effects: NO_EFFECTS }
  }
}

/** Applies `event` to `file`. A file that becomes active clears passive selections in the other files and keeps their drafts and edits. */
export function transitionReviewCommentModes(modes: ReviewCommentModes, file: string, event: LineCommentEvent) {
  const current = reviewFileCommentMode(modes, file)
  const step = transitionLineComment(current, event)

  if (step.state === current) return { modes, effects: step.effects }

  const next = Object.fromEntries(
    Object.entries(modes).filter(
      ([other, mode]) =>
        other !== file && (step.state.status === "idle" || mode.status === "drafting" || mode.status === "editing"),
    ),
  )

  if (step.state.status !== "idle") next[file] = step.state

  return {
    modes: Object.keys(next).length === 0 ? EMPTY_REVIEW_COMMENT_MODES : next,
    effects: step.effects,
  }
}

export function viewLineComment(state: LineCommentMode) {
  return {
    selected: state.status === "idle" ? null : state.range,
    draftRange: state.status === "drafting" ? state.range : null,
    draftText: state.status === "drafting" ? state.text : "",
    gutterSelected: state.status === "selecting" || state.status === "drafting" ? state.range : null,
  }
}

export function viewCommentItem(state: LineCommentMode, id: string) {
  const editing = state.status === "editing" && state.id === id

  return {
    open: editing || (state.status === "viewing" && state.id === id),
    editing,
    editText: editing ? state.text : "",
  }
}

export function reviewFileCommentMode(modes: ReviewCommentModes, file: string): LineCommentMode {
  return modes[file] ?? IDLE_LINE_COMMENT_MODE
}

function sameSelectedRange(a: SelectedLineRange, b: SelectedLineRange) {
  return a.start === b.start && a.end === b.end && a.side === b.side && (a.endSide ?? a.side) === (b.endSide ?? b.side)
}

function openDraft(state: LineCommentMode, range: SelectedLineRange): LineCommentTransition {
  if (state.status === "editing") return stay(state)

  if (state.status !== "drafting") return enter({ status: "drafting", range: cloneSelectedLineRange(range), text: "" })

  if (sameSelectedRange(state.range, range)) return stay(state)

  return enter({ status: "drafting", range: cloneSelectedLineRange(range), text: state.text })
}

function clear(state: LineCommentMode): LineCommentTransition {
  if (state.status === "idle" || holdsText(state)) return stay(state)

  return enter(IDLE_LINE_COMMENT_MODE)
}

// Typed draft text and an open edit are never discarded by a selection, click or focus elsewhere in the file.
function holdsText(state: LineCommentMode) {
  if (state.status === "editing") return true

  return state.status === "drafting" && state.text.trim().length > 0
}

function enter(state: LineCommentMode, ...effects: LineCommentEffect[]): LineCommentTransition {
  return {
    state,
    effects: [{ type: "sync-selected", range: state.status === "idle" ? null : state.range }, ...effects],
  }
}

function stay(state: LineCommentMode): LineCommentTransition {
  return { state, effects: NO_EFFECTS }
}
