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

// IDs as the server makes them: a prefix, then a part that ascends with creation.
const shell = "sh_1e1dbe17b0010Bv53WdPWVw1ic"

// The assistant message whose step started the shell, and the one of the step after it.
const before = "msg_1e1dbb5d70016rDeImJAWn2Q0N"

const after = "msg_1e1dbffc7001uxmmSBrKBNDabs"

// A reveal that did not find its call, as the virtualizer reports it.
const requested = (target = shell) => ({ type: "reveal.requested", target, found: false }) as const

// Built the way the driver's effect builds it.
const synced = (input: { found?: boolean; oldestAssistantID?: string; history?: HistorySeekStatus } = {}) =>
  ({
    type: "seek.synced",
    found: input.found ?? false,
    oldestAssistantID: "oldestAssistantID" in input ? input.oldestAssistantID : after,
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

test.each<{ name: string; event: RevealSeekEvent }>([
  // A shell a Code Mode script started has no call: it used to page through the whole session.
  { name: "an assistant message older than the shell is loaded", event: synced({ oldestAssistantID: before }) },
  { name: "history ran out", event: synced({ history: "exhausted" }) },
  { name: "a page failed", event: synced({ history: "failed" }) },
  { name: "the reader scrolled", event: SEEK_CANCELLED_EVENT },
])("a seek ends without another page once $name", (input) => {
  const ended = replay([requested(), input.event])

  expect(revealSeekTarget(ended.state)).toBeUndefined()
  expect(ended.effects).toEqual([])
})

test("a seek waits while no assistant message is loaded", () => {
  const next = replay([requested(), synced({ oldestAssistantID: undefined })])

  expect(revealSeekTarget(next.state)).toBe(shell)
  expect(next.effects).toEqual([{ type: "history.seek" }])
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
  expect(transitionRevealSeek(seeking, synced()).state).toBe(seeking)
})
