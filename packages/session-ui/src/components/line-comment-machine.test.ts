import { describe, expect, test } from "bun:test"
import type { SelectedLineRange } from "@pierre/diffs"
import {
  EMPTY_REVIEW_COMMENT_MODES,
  IDLE_LINE_COMMENT_MODE,
  reviewFileCommentMode,
  transitionLineComment,
  transitionReviewCommentModes,
  viewCommentItem,
  viewLineComment,
  type LineCommentEvent,
  type LineCommentMode,
  type LineCommentTransition,
  type ReviewCommentModes,
} from "./line-comment-machine"

const line = (start: number, end = start): SelectedLineRange => ({ start, end, side: "additions" })

function replay(events: LineCommentEvent[], state: LineCommentMode = IDLE_LINE_COMMENT_MODE) {
  return events.reduce((current, event) => transitionLineComment(current, event).state, state)
}

function replayFiles(steps: [string, LineCommentEvent][], modes: ReviewCommentModes = EMPTY_REVIEW_COMMENT_MODES) {
  return steps.reduce((current, [file, event]) => transitionReviewCommentModes(current, file, event).modes, modes)
}

describe("transitionLineComment", () => {
  test("the gutter button, a line click or a cleared selection keeps the text of an open edit", () => {
    const editing = replay([
      { type: "edit.opened", id: "c1", range: line(2), text: "original" },
      { type: "edit.changed", text: "updated" },
    ])

    const events: LineCommentEvent[] = [
      { type: "draft.opened", range: line(5) },
      { type: "line.selected", range: line(8) },
      { type: "line.selection-ended", range: line(8) },
      { type: "line.selected", range: null },
      { type: "line.selection-ended", range: null },
    ]

    for (const event of events) expect(transitionLineComment(editing, event)).toEqual({ state: editing, effects: [] })
    expect(editing).toEqual({ status: "editing", id: "c1", range: line(2), text: "updated" })
  })

  test("a repeated selection end for the same lines keeps the typed draft, and a new range moves it", () => {
    const drafting = replay([
      { type: "line.selection-ended", range: line(1, 3) },
      { type: "draft.changed", text: "keep me" },
    ])

    // The line-number drag used to open the draft again one frame later, which emptied it.
    expect(transitionLineComment(drafting, { type: "draft.opened", range: line(1, 3) }).state).toBe(drafting)
    expect(transitionLineComment(drafting, { type: "line.selection-ended", range: line(1, 3) }).state).toBe(drafting)

    expect(transitionLineComment(drafting, { type: "line.selection-ended", range: line(1, 5) })).toEqual({
      state: { status: "drafting", range: line(1, 5), text: "keep me" },
      effects: [{ type: "sync-selected", range: line(1, 5) }],
    })
  })

  test("a typed draft survives a cleared selection, and an empty one closes", () => {
    const typed = replay([
      { type: "draft.opened", range: line(4) },
      { type: "draft.changed", text: "wip" },
    ])

    expect(transitionLineComment(typed, { type: "line.selected", range: null }).state).toBe(typed)
    expect(transitionLineComment(typed, { type: "line.selection-ended", range: null }).state).toBe(typed)

    const empty = replay([{ type: "draft.opened", range: line(4) }])

    expect(transitionLineComment(empty, { type: "line.selection-ended", range: null })).toEqual({
      state: IDLE_LINE_COMMENT_MODE,
      effects: [{ type: "sync-selected", range: null }],
    })
  })

  test("deleting one comment keeps a draft, another comment's edit, and closes only the deleted comment", () => {
    const drafting: LineCommentMode = { status: "drafting", range: line(20), text: "wip" }
    const editingOther: LineCommentMode = { status: "editing", id: "c2", range: line(10), text: "wip" }

    for (const state of [drafting, editingOther]) {
      const step = transitionLineComment(state, { type: "comment.deleted", id: "c1" })

      expect(step.state).toBe(state)
      expect(step.effects).toEqual([{ type: "delete-comment", id: "c1" }])
    }

    const own: LineCommentMode[] = [
      { status: "editing", id: "c1", range: line(5), text: "wip" },
      { status: "viewing", id: "c1", range: line(5) },
    ]

    for (const state of own)
      expect(transitionLineComment(state, { type: "comment.deleted", id: "c1" })).toEqual({
        state: IDLE_LINE_COMMENT_MODE,
        effects: [
          { type: "sync-selected", range: null },
          { type: "delete-comment", id: "c1" },
        ],
      })
  })

  test("clicking a comment never leaves a draft and an open comment at the same time", () => {
    const empty = transitionLineComment(
      { status: "drafting", range: line(5), text: "" },
      { type: "comment.toggled", id: "c1", range: line(2) },
    ).state

    expect(empty).toEqual({ status: "viewing", id: "c1", range: line(2) })
    expect(viewLineComment(empty).draftRange).toBeNull()

    const typed: LineCommentMode = { status: "drafting", range: line(5), text: "unsent" }
    const kept = transitionLineComment(typed, { type: "comment.toggled", id: "c1", range: line(2) }).state

    expect(kept).toBe(typed)
    expect(viewCommentItem(kept, "c1").open).toBe(false)
  })

  test("toggling the open comment closes it, and another comment replaces it", () => {
    const viewing = replay([{ type: "comment.toggled", id: "c1", range: line(2) }])

    expect(viewCommentItem(viewing, "c1")).toEqual({ open: true, editing: false, editText: "" })
    expect(transitionLineComment(viewing, { type: "comment.toggled", id: "c2", range: line(7) }).state).toEqual({
      status: "viewing",
      id: "c2",
      range: line(7),
    })
    expect(transitionLineComment(viewing, { type: "comment.toggled", id: "c1", range: line(2) })).toEqual({
      state: IDLE_LINE_COMMENT_MODE,
      effects: [{ type: "sync-selected", range: null }],
    })
  })

  test("a focus request opens the comment unless typed text would be lost", () => {
    const step = transitionLineComment(
      { status: "selecting", range: line(9) },
      { type: "comment.focused", id: "c1", range: line(2) },
    )

    expect(step).toEqual({
      state: { status: "viewing", id: "c1", range: line(2) },
      effects: [{ type: "sync-selected", range: line(2) }],
    })
    expect(transitionLineComment(step.state, { type: "comment.focused", id: "c1", range: line(2) }).state).toBe(
      step.state,
    )

    const typed: LineCommentMode = { status: "drafting", range: line(5), text: "unsent" }
    const editing: LineCommentMode = { status: "editing", id: "c2", range: line(3), text: "x" }

    expect(transitionLineComment(typed, { type: "comment.focused", id: "c1", range: line(2) }).state).toBe(typed)
    expect(transitionLineComment(editing, { type: "comment.focused", id: "c1", range: line(2) }).state).toBe(editing)
  })

  test("hovering a comment previews its lines only while nothing is open", () => {
    expect(transitionLineComment(IDLE_LINE_COMMENT_MODE, { type: "comment.hovered", range: line(3) })).toEqual({
      state: { status: "selecting", range: line(3) },
      effects: [{ type: "sync-selected", range: line(3) }],
    })

    const held: LineCommentMode[] = [
      { status: "selecting", range: line(3) },
      { status: "viewing", id: "c1", range: line(2) },
      { status: "drafting", range: line(5), text: "" },
      { status: "editing", id: "c1", range: line(2), text: "x" },
    ]

    for (const state of held)
      expect(transitionLineComment(state, { type: "comment.hovered", range: line(3) }).state).toBe(state)
  })

  test("submitting trims the text, rejects blank text and clears the selection first", () => {
    const drafting: LineCommentMode = { status: "drafting", range: line(1, 2), text: "  note  " }

    expect(transitionLineComment(drafting, { type: "draft.submitted", text: "   " }).state).toBe(drafting)
    expect(transitionLineComment(drafting, { type: "draft.submitted", text: "  note  " })).toEqual({
      state: IDLE_LINE_COMMENT_MODE,
      effects: [
        { type: "sync-selected", range: null },
        { type: "submit-draft", comment: "note", selection: line(1, 2) },
      ],
    })

    const editing: LineCommentMode = { status: "editing", id: "c1", range: line(4), text: "x" }

    expect(transitionLineComment(editing, { type: "edit.submitted", text: "\n" }).state).toBe(editing)
    expect(transitionLineComment(editing, { type: "edit.submitted", text: " fixed " })).toEqual({
      state: IDLE_LINE_COMMENT_MODE,
      effects: [
        { type: "sync-selected", range: null },
        { type: "submit-edit", id: "c1", comment: "fixed", selection: line(4) },
      ],
    })
  })

  test("cancel, passive clear and reset exit to idle", () => {
    const drafting: LineCommentMode = { status: "drafting", range: line(1), text: "x" }
    const editing: LineCommentMode = { status: "editing", id: "c1", range: line(4), text: "x" }
    const selecting: LineCommentMode = { status: "selecting", range: line(2) }
    const viewing: LineCommentMode = { status: "viewing", id: "c1", range: line(4) }
    const cleared: LineCommentTransition = {
      state: IDLE_LINE_COMMENT_MODE,
      effects: [{ type: "sync-selected", range: null }],
    }

    expect(transitionLineComment(drafting, { type: "draft.cancelled" })).toEqual(cleared)
    expect(transitionLineComment(editing, { type: "edit.cancelled" })).toEqual(cleared)
    expect(transitionLineComment(drafting, { type: "edit.cancelled" }).state).toBe(drafting)
    expect(transitionLineComment(editing, { type: "draft.cancelled" }).state).toBe(editing)

    for (const state of [selecting, viewing])
      expect(transitionLineComment(state, { type: "passive.cleared" })).toEqual({
        state: IDLE_LINE_COMMENT_MODE,
        effects: [],
      })

    for (const state of [drafting, editing])
      expect(transitionLineComment(state, { type: "passive.cleared" }).state).toBe(state)

    for (const state of [drafting, editing, selecting, viewing])
      expect(transitionLineComment(state, { type: "reset" })).toEqual({ state: IDLE_LINE_COMMENT_MODE, effects: [] })
  })

  test("events that do not apply return the same state", () => {
    const states: LineCommentMode[] = [
      IDLE_LINE_COMMENT_MODE,
      { status: "selecting", range: line(2) },
      { status: "viewing", id: "c1", range: line(4) },
    ]

    const events: LineCommentEvent[] = [
      { type: "draft.changed", text: "x" },
      { type: "draft.cancelled" },
      { type: "draft.submitted", text: "x" },
      { type: "edit.changed", text: "x" },
      { type: "edit.cancelled" },
      { type: "edit.submitted", text: "x" },
    ]

    for (const state of states)
      for (const event of events) expect(transitionLineComment(state, event).state).toBe(state)

    expect(transitionLineComment(IDLE_LINE_COMMENT_MODE, { type: "reset" }).state).toBe(IDLE_LINE_COMMENT_MODE)
    expect(transitionLineComment(IDLE_LINE_COMMENT_MODE, { type: "line.selected", range: null }).state).toBe(
      IDLE_LINE_COMMENT_MODE,
    )
  })
})

describe("transitionReviewCommentModes", () => {
  test("hovering in one file keeps another file's draft and its selected lines", () => {
    const modes = replayFiles([
      ["b.ts", { type: "draft.opened", range: line(3) }],
      ["b.ts", { type: "draft.changed", text: "wip" }],
      ["a.ts", { type: "comment.hovered", range: line(1) }],
    ])

    expect(viewLineComment(reviewFileCommentMode(modes, "b.ts"))).toMatchObject({
      selected: line(3),
      draftRange: line(3),
      draftText: "wip",
    })
    expect(reviewFileCommentMode(modes, "a.ts")).toEqual({ status: "selecting", range: line(1) })
  })

  test("a selection in one file clears passive selections in the others", () => {
    const modes = replayFiles([
      ["a.ts", { type: "line.selected", range: line(1) }],
      ["c.ts", { type: "comment.toggled", id: "c1", range: line(5) }],
    ])

    expect(Object.keys(modes)).toEqual(["c.ts"])
  })

  test("an edit keeps its file active while the user selects elsewhere", () => {
    const modes = replayFiles([
      ["d.ts", { type: "edit.opened", id: "d1", range: line(4), text: "edit" }],
      ["a.ts", { type: "line.selected", range: line(2) }],
      ["a.ts", { type: "line.selected", range: null }],
    ])

    expect(reviewFileCommentMode(modes, "d.ts").status).toBe("editing")
    expect(reviewFileCommentMode(modes, "a.ts").status).toBe("idle")
  })

  test("ignored events keep the same map, and the last idle file returns the empty map", () => {
    const modes = replayFiles([["a.ts", { type: "line.selected", range: line(1) }]])

    expect(transitionReviewCommentModes(modes, "a.ts", { type: "line.selected", range: line(1) }).modes).toBe(modes)
    expect(transitionReviewCommentModes(modes, "a.ts", { type: "reset" }).modes).toBe(EMPTY_REVIEW_COMMENT_MODES)
  })
})
