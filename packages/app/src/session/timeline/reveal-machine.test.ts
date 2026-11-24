import { expect, test } from "bun:test"
import type { HistorySeekStatus } from "./history-machine"
import {
  createRevealSeekState,
  revealSeekTarget,
  SEEK_CANCELLED_EVENT,
  transitionRevealSeek,
  type RevealSeekEffect,
  type RevealSeekEvent,
  type RevealSeekState,
} from "./reveal-machine"

const shell = "sh_1e1dbe17b0010Bv53WdPWVw1ic"

// A reveal that did not find its call, as the virtualizer reports it.
const requested = (target = shell) => ({ type: "reveal.requested", target, found: false }) as const

// Built the way the driver's effect builds it.
const synced = (input: { found?: boolean; history?: HistorySeekStatus } = {}) =>
  ({
    type: "seek.synced",
    found: input.found ?? false,
    history: input.history ?? "seekable",
  }) satisfies RevealSeekEvent

function replay(events: RevealSeekEvent[]) {
  return events.reduce<{ state: RevealSeekState; effects: RevealSeekEffect[] }>(
    (acc, event) => {
      const next = transitionRevealSeek(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state: createRevealSeekState(), effects: [] },
  )
}

test("a shell's call that is not loaded pages history until it is found", () => {
  const seeking = replay([requested()])
  expect(revealSeekTarget(seeking.state)).toBe(shell)

  // One page per sync that finds history ready; none while the page loads.
  const paged = replay([requested(), synced(), synced({ history: "loading" }), synced()])
  expect(revealSeekTarget(paged.state)).toBe(shell)
  expect(paged.effects).toEqual([{ type: "history.seek" }, { type: "history.seek" }])

  const found = replay([requested(), synced(), synced({ found: true })])
  expect(revealSeekTarget(found.state)).toBeUndefined()
  expect(found.effects).toEqual([{ type: "history.seek" }])
})

// A shell that a Code Mode script started has no call. Where its call would be was read from the order of two IDs,
// which is not the transcript's order: the search could end before the call, or load the whole session.
test("a search loads ten older pages and no more, wherever the call is", () => {
  const pages = Array.from({ length: 13 }, () => synced())
  const ended = replay([requested(), ...pages])

  expect(revealSeekTarget(ended.state)).toBeUndefined()
  expect(ended.effects).toHaveLength(10)

  // The reader's next click searches again, from what is loaded by then.
  const again = replay([requested(), ...pages, requested(), synced()])
  expect(revealSeekTarget(again.state)).toBe(shell)
  expect(again.effects).toHaveLength(11)
})

test.each<{ name: string; event: RevealSeekEvent }>([
  { name: "history ran out", event: synced({ history: "exhausted" }) },
  { name: "a page failed", event: synced({ history: "failed" }) },
  { name: "the reader scrolled", event: SEEK_CANCELLED_EVENT },
])("a seek ends without another page once $name", (input) => {
  const ended = replay([requested(), input.event])

  expect(revealSeekTarget(ended.state)).toBeUndefined()
  expect(ended.effects).toEqual([])
})

test("a call named by its own ID does not page history", () => {
  expect(revealSeekTarget(replay([requested("toolu_0186aieMGq1P5bArLj3ErJdA")]).state)).toBeUndefined()
})

test("the reader's next reveal replaces a seek under way", () => {
  const other = "sh_1dbbc79d1001QOMb3Do3RUuxd9"
  expect(revealSeekTarget(replay([requested(), requested(other)]).state)).toBe(other)
  // A call that was loaded is on screen now, so the earlier one must not take the view from it later.
  expect(
    revealSeekTarget(replay([requested(), { type: "reveal.requested", target: other, found: true }]).state),
  ).toBeUndefined()
})

test("events that change nothing return the same state", () => {
  const idle = createRevealSeekState()
  expect(transitionRevealSeek(idle, synced()).state).toBe(idle)
  expect(transitionRevealSeek(idle, SEEK_CANCELLED_EVENT).state).toBe(idle)

  const seeking = replay([requested()]).state
  expect(transitionRevealSeek(seeking, requested()).state).toBe(seeking)
  expect(transitionRevealSeek(seeking, synced({ history: "loading" })).state).toBe(seeking)
})
