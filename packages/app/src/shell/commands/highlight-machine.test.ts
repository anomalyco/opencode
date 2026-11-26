import { describe, expect, test } from "bun:test"
import {
  INITIAL_PALETTE_HIGHLIGHT_STATE,
  transitionPaletteHighlight,
  type PaletteHighlightEffect,
  type PaletteHighlightEvent,
  type PaletteHighlightState,
} from "./highlight-machine"

function replay(events: PaletteHighlightEvent[], state: PaletteHighlightState = INITIAL_PALETTE_HIGHLIGHT_STATE) {
  return events.reduce<{ state: PaletteHighlightState; effects: PaletteHighlightEffect[] }>(
    (acc, event) => {
      const next = transitionPaletteHighlight(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const highlightA: PaletteHighlightEvent = { type: "highlight.changed", entryID: "command:a", previewable: true }

describe("palette highlight machine", () => {
  test("choosing another entry than the previewed one reverts the preview", () => {
    expect(replay([highlightA, { type: "entry.selected", entryID: "file:readme.md" }])).toEqual({
      state: { status: "committed" },
      effects: [{ type: "preview.apply", entryID: "command:a" }, { type: "preview.revert" }],
    })
  })

  test("choosing the previewed entry keeps its preview, even when the palette closes", () => {
    expect(replay([highlightA, { type: "entry.selected", entryID: "command:a" }, { type: "disposed" }])).toEqual({
      state: { status: "committed" },
      effects: [{ type: "preview.apply", entryID: "command:a" }],
    })
  })

  test("a highlight while the committed palette closes previews nothing", () => {
    const committed = replay([{ type: "entry.selected", entryID: "command:a" }]).state
    const late = replay([{ type: "highlight.changed", entryID: "command:b", previewable: true }], committed)

    expect(late).toEqual({ state: committed, effects: [] })
  })

  test("moving the highlight swaps previews once, and closing without a choice reverts", () => {
    expect(
      replay([
        highlightA,
        highlightA,
        { type: "highlight.changed", entryID: "command:b", previewable: true },
        { type: "highlight.changed", entryID: "file:readme.md", previewable: false },
        highlightA,
        { type: "disposed" },
      ]).effects,
    ).toEqual([
      { type: "preview.apply", entryID: "command:a" },
      { type: "preview.revert" },
      { type: "preview.apply", entryID: "command:b" },
      { type: "preview.revert" },
      { type: "preview.apply", entryID: "command:a" },
      { type: "preview.revert" },
    ])
  })
})
