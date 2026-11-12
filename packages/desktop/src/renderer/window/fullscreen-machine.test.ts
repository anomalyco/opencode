import { expect, test } from "bun:test"
import {
  createFullscreenState,
  selectWindowFullscreen,
  transitionFullscreen,
  type FullscreenEvent,
} from "./fullscreen-machine"

function replay(events: readonly FullscreenEvent[]) {
  return events.reduce(transitionFullscreen, createFullscreenState())
}

test.each([
  {
    name: "a late boot read cannot undo leaving fullscreen",
    events: [
      { type: "fullscreen.changed", fullscreen: false },
      { type: "fullscreen.seeded", fullscreen: true },
    ],
    fullscreen: false,
  },
  {
    name: "a late boot read cannot undo entering fullscreen",
    events: [
      { type: "fullscreen.changed", fullscreen: true },
      { type: "fullscreen.seeded", fullscreen: false },
    ],
    fullscreen: true,
  },
  {
    name: "the boot read seeds the window",
    events: [{ type: "fullscreen.seeded", fullscreen: true }],
    fullscreen: true,
  },
  {
    name: "a failed boot read draws the window windowed until main reports a change",
    events: [{ type: "fullscreen.seed-failed" }],
    fullscreen: false,
  },
  {
    name: "events after a failed boot read still apply",
    events: [{ type: "fullscreen.seed-failed" }, { type: "fullscreen.changed", fullscreen: true }],
    fullscreen: true,
  },
] satisfies { name: string; events: FullscreenEvent[]; fullscreen: boolean }[])("$name", (item) => {
  expect(selectWindowFullscreen(replay(item.events))).toBe(item.fullscreen)
})

test("a repeated value keeps the same state so the signal is not written", () => {
  const state = replay([{ type: "fullscreen.changed", fullscreen: true }])

  expect(transitionFullscreen(state, { type: "fullscreen.changed", fullscreen: true })).toBe(state)
  expect(transitionFullscreen(state, { type: "fullscreen.seeded", fullscreen: true })).toBe(state)
})
