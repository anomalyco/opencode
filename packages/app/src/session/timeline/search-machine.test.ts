import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import {
  createTimelineSearchState,
  findMatchesInParts,
  normalizeSearchQuery,
  searchableSources,
  TIMELINE_SEARCH_SEEK_LIMIT,
  timelineSearchView,
  transitionTimelineSearch,
  type TimelineSearchEffect,
  type TimelineSearchEvent,
  type TimelineSearchState,
  type TimelineSearchTransition,
} from "./search-machine"
import { createSearchText } from "./search-text"

const user = (id: string, text: string): SessionMessageInfo => ({ id, type: "user", time: { created: 1 }, text })

const assistant = (id: string, ...texts: string[]): SessionMessageInfo => ({
  id,
  type: "assistant",
  time: { created: 2 },
  agent: "build",
  model: { id: "fixture", providerID: "fixture" },
  content: texts.map((text) => ({ type: "text", text })),
})

const shell = (id: string): SessionMessageInfo => ({
  id,
  type: "shell",
  shellID: "sh_test",
  command: "echo prompt",
  status: "exited",
  time: { created: 3 },
})

const history = [
  user("msg_u1", "Write a prompt"),
  assistant("msg_a1", "Here is a prompt and another prompt"),
  user("msg_u2", "Shorter please"),
  assistant("msg_a2", "One prompt"),
]

// Builds matches the way the driver does before a part is read: its text lowercased, then the normalized query.
const find = (messages: SessionMessageInfo[], value: string) =>
  findMatchesInParts(
    createSearchText({ read: () => new Promise(() => {}), changed: () => {} }).parts(searchableSources(messages)),
    normalizeSearchQuery(value),
  )

const typed = (value: string, messages = history): TimelineSearchEvent => ({
  type: "query.changed",
  value,
  matches: find(messages, value),
})

const synced = (messages: SessionMessageInfo[], value = "prompt", sessionID = "ses_1"): TimelineSearchEvent => ({
  type: "matches.synced",
  sessionID,
  matches: find(messages, value),
})

function replay(events: TimelineSearchEvent[], from = createTimelineSearchState()) {
  const initial: TimelineSearchTransition = { state: from, effects: [] }

  return events.reduce((current, event) => transitionTimelineSearch(current.state, event), initial)
}

const opened = (...events: TimelineSearchEvent[]) => replay([{ type: "open", sessionID: "ses_1" }, ...events])

// A probe that found the match where `top` centres it, with the view at `at`: on the match unless a test says where.
const ready = (attempt: number, top: number, at = top): TimelineSearchEvent => ({
  type: "seek.ready",
  attempt,
  top,
  at,
})

const missing = (attempt: number, at?: number): TimelineSearchEvent => ({ type: "seek.missing", attempt, at })

const folded = (attempt: number, foldID = "fold_1"): TimelineSearchEvent => ({ type: "seek.folded", attempt, foldID })

// A whole seek on a match that rests at `top` from the first frame it renders.
const landed = (attempt: number, top: number) =>
  Array.from({ length: TIMELINE_SEARCH_SEEK_LIMIT + 1 }, () => ready(attempt, top))

// The scrolls a seek on the first match makes for these probe results, the probes it asks for, and how it ends.
function scrolls(...events: TimelineSearchEvent[]) {
  const start = opened(typed("prompt"))
  const effects = events.flatMap((_, index) => replay(events.slice(0, index + 1), start.state).effects)

  return {
    state: replay(events, start.state).state,
    tops: effects.flatMap((effect) => (effect.type === "scroll" ? [effect.top] : [])),
    probes: [...start.effects, ...effects].filter((effect) => effect.type === "seek.schedule").length,
  }
}

function seeking(state: TimelineSearchState) {
  if (state.status !== "seeking") throw new Error(`expected seeking, got ${state.status}`)

  return state
}

// Every Enter used to start a frame chain that only stopped once its own match mounted, so a slow
// earlier match scrolled the timeline back after a later one had already settled.
test("a late result from an earlier seek never scrolls back to its match", () => {
  const first = opened(typed("prompt"))
  expect(first.state).toMatchObject({ status: "seeking", attempt: 1, activeIndex: 0 })

  const second = transitionTimelineSearch(first.state, { type: "move", delta: 1 })
  expect(second.state).toMatchObject({ status: "seeking", attempt: 2, activeIndex: 1 })
  expect(second.effects).toEqual([
    { type: "reveal", revealID: "msg_u1", partID: "msg_a1:text:0" },
    { type: "seek.schedule", attempt: 2, query: "prompt", partID: "msg_a1:text:0", occurrence: 0, allowUnfold: true },
  ])

  for (const late of [ready(1, 20), missing(1), folded(1)]) {
    const result = transitionTimelineSearch(second.state, late)
    expect(result.state).toBe(second.state)
    expect(result.effects).toEqual([])
  }

  const settled = replay(landed(2, 540), second.state)
  expect(settled.state).toMatchObject({ status: "open", activeIndex: 1 })
  expect(timelineSearchView(settled.state)).toMatchObject({ activeDisplay: 2, count: 4 })
})

// Find used to scroll to the match on the first frame it rendered, while the timeline was still bringing its row in
// and the rows above it were being measured. The timeline then scrolled on to the row's centre, away from the match.
test("Find scrolls to a match once it rests, not while its row is still moving", () => {
  expect(scrolls(ready(1, 74)).tops).toEqual([])
  expect(scrolls(ready(1, 74), ready(1, 305)).tops).toEqual([])
  expect(scrolls(ready(1, 74), ready(1, 305), ready(1, 305)).tops).toEqual([305])

  // The seek goes on to its last frame, and a match that stays where Find put it is not scrolled to again.
  const whole = scrolls(ready(1, 74), ...landed(1, 305).slice(1))
  expect(whole.tops).toEqual([305])
  expect(whole.probes).toBe(TIMELINE_SEARCH_SEEK_LIMIT + 1)
  expect(whole.state).toMatchObject({ status: "open", activeIndex: 0 })
  expect(whole.state).not.toHaveProperty("top")
})

// A reply above the match rendered its Markdown two frames after the match's own row, and grew by 647px in view. The
// seek had ended at its one scroll, so the match stayed where the reply pushed it, out of sight.
test("Find scrolls again when a row above the match renders late and moves it", () => {
  // The view is still where Find put it. The match is 647px further down.
  expect(scrolls(ready(1, 305), ready(1, 305), ready(1, 952, 305)).tops).toEqual([305])
  expect(scrolls(ready(1, 305), ready(1, 305), ready(1, 952, 305), ready(1, 952, 305)).tops).toEqual([305, 952])
})

// The same push can take the match's row out of the mounted rows, and then no probe finds the match again.
test("Find brings back a match that a row above it pushed out of the mounted rows", () => {
  const pushed = replay([ready(1, 305), ready(1, 305), missing(1, 305)], opened(typed("prompt")).state)
  expect(pushed.state).toMatchObject({ status: "seeking", retries: 3 })
  expect(pushed.effects).toEqual([
    { type: "reveal", revealID: "msg_u1", partID: "msg_u1:text:0" },
    { type: "seek.schedule", attempt: 1, query: "prompt", partID: "msg_u1:text:0", occurrence: 0, allowUnfold: true },
  ])

  // Its row is brought in once, not on every frame it takes to mount.
  expect(transitionTimelineSearch(pushed.state, missing(1, 74)).effects).toEqual([
    { type: "seek.schedule", attempt: 1, query: "prompt", partID: "msg_u1:text:0", occurrence: 0, allowUnfold: true },
  ])

  // Back in the place Find scrolled to before, it is scrolled to again: the timeline went to its row since.
  expect(
    scrolls(ready(1, 305), ready(1, 305), missing(1, 305), ready(1, 305, 74), ready(1, 305, 74)).tops,
  ).toEqual([305, 305])
})

// Find held its match for the rest of twelve frames after it scrolled there, and took a missing row for one that a
// late row had pushed out. A reader who pressed End in that time unmounted the row, and Find brought it back: the
// view returned to a match 2,659 to 4,882px from the latest message.
test.each<{ name: string; probe: TimelineSearchEvent }>([
  { name: "and the match's row is gone", probe: missing(1, 4200) },
  { name: "and the match rests where it was", probe: ready(1, 305, 4200) },
  { name: "while a late row moved the match", probe: ready(1, 952, 4200) },
])("Find leaves the view to a reader who moved it after Find scrolled, $name", ({ probe }) => {
  const result = scrolls(ready(1, 305), ready(1, 305), probe)
  expect(result.tops).toEqual([305])
  expect(result.state).toMatchObject({ status: "open", activeIndex: 0 })
  expect(replay([ready(1, 305), ready(1, 305), probe], opened(typed("prompt")).state).effects).toEqual([])
})

// A row above the fold that measures moves the scroll offset and the match's place by the same distance.
test("Find keeps a match whose view a size correction moved with it", () => {
  const result = scrolls(ready(1, 305), ready(1, 305), ready(1, 952, 952), ready(1, 952, 952))
  expect(result.tops).toEqual([305, 952])
  expect(result.state).toMatchObject({ status: "seeking", landed: 952 })
})

test("the reader's scroll ends a seek and keeps the match and the count", () => {
  const start = opened(typed("prompt"), ready(1, 305))
  const moved = transitionTimelineSearch(start.state, { type: "reader.scrolled" })
  expect(moved.state).toMatchObject({ status: "open", activeIndex: 0 })
  expect(moved.effects).toEqual([{ type: "seek.cancel" }, { type: "reveal.stop" }])
  expect(timelineSearchView(moved.state)).toMatchObject({ activeDisplay: 1, count: 4, activePartID: "msg_u1:text:0" })

  // The seek's probes are stale, and a scroll with no seek under way changes nothing.
  for (const event of [ready(1, 305), missing(1, 305), { type: "reader.scrolled" } as const]) {
    const result = transitionTimelineSearch(moved.state, event)
    expect(result.state).toBe(moved.state)
    expect(result.effects).toEqual([])
  }
})

test("a match that never rests is scrolled to on the seek's last frame", () => {
  const moving = Array.from({ length: TIMELINE_SEARCH_SEEK_LIMIT }, (_, index) => ready(1, index * 40))
  expect(scrolls(...moving).tops).toEqual([])

  const result = scrolls(...moving, ready(1, 900))
  expect(result.tops).toEqual([900])
  expect(result.state).toMatchObject({ status: "open", activeIndex: 0 })
})

// A fold toggle that did not open the message used to be clicked again on every frame while Find stayed open.
test("a fold that stays closed settles instead of clicking its toggle every frame", () => {
  const start = opened(typed("prompt"))
  const unfolding = transitionTimelineSearch(start.state, folded(1))
  expect(unfolding.state).toMatchObject({ status: "seeking", unfolded: true })
  expect(unfolding.effects).toEqual([
    { type: "unfold", foldID: "fold_1" },
    { type: "seek.schedule", attempt: 1, query: "prompt", partID: "msg_u1:text:0", occurrence: 0, allowUnfold: false },
  ])

  const again = transitionTimelineSearch(unfolding.state, folded(1))
  expect(again.state.status).toBe("open")
  expect(again.effects).toEqual([])
})

test.each([
  { name: "once it rests", retries: 0, probes: 2, status: "seeking" },
  {
    name: "at once after the row took every retry to mount",
    retries: TIMELINE_SEARCH_SEEK_LIMIT,
    probes: 1,
    status: "open",
  },
])("an unfolded match scrolls into view $name", ({ retries, probes, status }) => {
  const result = scrolls(
    ...Array.from({ length: retries }, () => missing(1)),
    folded(1),
    ...Array.from({ length: probes }, () => ready(1, 640)),
  )

  expect(result.tops).toEqual([640])
  expect(result.state).toMatchObject({ status, activeIndex: 0 })
})

test("a seek gives up after its retry budget without scrolling", () => {
  const start = opened(typed("prompt"))

  const exhausted = Array.from({ length: TIMELINE_SEARCH_SEEK_LIMIT }).reduce<TimelineSearchTransition>(
    (current, _, index) => {
      const next = transitionTimelineSearch(current.state, missing(1))
      expect(seeking(next.state).retries).toBe(index + 1)
      expect(next.effects).toEqual([
        {
          type: "seek.schedule",
          attempt: 1,
          query: "prompt",
          partID: "msg_u1:text:0",
          occurrence: 0,
          allowUnfold: true,
        },
      ])

      return next
    },
    start,
  )

  const result = transitionTimelineSearch(exhausted.state, missing(1))
  expect(result.state).toMatchObject({ status: "open", activeIndex: 0 })
  expect(result.effects).toEqual([])
})

// The selected index used to survive in the store past the end of a shorter list, and came back once
// the list grew again.
test("a match list that shrinks and grows again keeps the first match selected", () => {
  const fourth = opened(typed("prompt"), { type: "move", delta: 3 }, ...landed(2, 0))
  expect(timelineSearchView(fourth.state)).toMatchObject({ activeDisplay: 4, count: 4 })

  // A revert removes the last turn, and the selected fourth match with it.
  const shrunk = transitionTimelineSearch(fourth.state, synced(history.slice(0, 2)))
  expect(timelineSearchView(shrunk.state)).toMatchObject({ activeDisplay: 1, count: 3 })

  const grown = transitionTimelineSearch(shrunk.state, synced(history))
  expect(grown.state).toMatchObject({ activeIndex: 0 })
  expect(timelineSearchView(grown.state)).toMatchObject({ activeDisplay: 1, count: 4 })
})

test("streamed matches around the sought match keep the seek on it", () => {
  const start = opened(typed("prompt"), { type: "move", delta: 1 })
  const grown = [user("msg_u0", "First prompt"), ...history]
  const result = transitionTimelineSearch(start.state, synced(grown))
  expect(result.state).toMatchObject({ status: "seeking", attempt: 2, activeIndex: 2 })
  expect(result.effects).toEqual([])

  const unchanged = transitionTimelineSearch(result.state, synced(grown))
  expect(unchanged.state).toBe(result.state)
})

test.each([
  {
    name: "close",
    event: { type: "close" },
    status: "closed",
    effects: [{ type: "seek.cancel" }, { type: "blur-input" }],
  },
  { name: "dispose", event: { type: "disposed" }, status: "closed", effects: [{ type: "cancel-frames" }] },
  { name: "clear the query", event: typed(""), status: "open", effects: [{ type: "seek.cancel" }] },
  { name: "type a query without results", event: typed("missing"), status: "open", effects: [{ type: "seek.cancel" }] },
  {
    name: "lose the sought match",
    event: synced(history.slice(0, 2)),
    status: "open",
    effects: [{ type: "seek.cancel" }],
  },
  {
    name: "switch session",
    event: { type: "session.changed", sessionID: "ses_2", matches: find([user("msg_x", "prompt")], "prompt") },
    status: "open",
    effects: [{ type: "seek.cancel" }],
  },
] satisfies {
  name: string
  event: TimelineSearchEvent
  status: TimelineSearchState["status"]
  effects: TimelineSearchEffect[]
}[])("$name cancels an in-flight seek", ({ event, status, effects }) => {
  const start = opened(typed("prompt"), { type: "move", delta: 3 })
  const result = transitionTimelineSearch(start.state, event)
  expect(result.state.status).toBe(status)
  expect(result.state).not.toHaveProperty("retries")
  expect(result.effects).toEqual(effects)

  if (result.state.status !== "closed") expect(result.state.activeIndex).toBe(0)

  const late = transitionTimelineSearch(result.state, ready(2, 900))
  expect(late.state).toBe(result.state)
  expect(late.effects).toEqual([])
})

// Find counted a part's hits in its Markdown source. A step to one that the part does not show, such as a marker or
// the destination behind a link's label, ran the seek out with nothing on screen: "3/6" and no active match.
test.each([
  { name: "forward to the next hit that is shown", steps: [1, 1], lands: 2, shown: "**c**" },
  { name: "backward to the hit before it", steps: [-1, -1, -1], lands: 1, shown: "**a**" },
])("a seek goes on $name when the part it was going to is read and shows no hit", ({ steps, lands }) => {
  const messages = [user("msg_u1", "**a**"), assistant("msg_a1", "**b**"), user("msg_u2", "**c**")]
  const text = createSearchText({ read: () => new Promise(() => {}), changed: () => {} })
  const matches = () => findMatchesInParts(text.parts(searchableSources(messages)), "**")

  const start = replay(
    steps.map((delta): TimelineSearchEvent => ({ type: "move", delta })),
    opened({ type: "query.changed", value: "**", matches: matches() }).state,
  )
  expect(timelineSearchView(start.state)).toMatchObject({ count: 6, activePartID: "msg_a1:text:0" })

  // The reply has rendered: its bold text shows no asterisk.
  text.rendered("msg_a1:text:0", "b")
  const read = transitionTimelineSearch(start.state, { type: "matches.read", sessionID: "ses_1", matches: matches() })
  expect(read.state).toMatchObject({ status: "seeking", activeIndex: lands, attempt: seeking(start.state).attempt + 1 })
  expect(timelineSearchView(read.state)).toMatchObject({ count: 4, activeDisplay: lands + 1 })
  expect(read.effects.map((effect) => effect.type)).toEqual(["reveal", "seek.schedule"])

  // Find at rest keeps its place in the list and does not scroll.
  const rested = replay(landed(seeking(start.state).attempt, 300), start.state)
  const late = transitionTimelineSearch(rested.state, { type: "matches.read", sessionID: "ses_1", matches: matches() })
  expect(late.state).toMatchObject({ status: "open", activeIndex: 0 })
  expect(late.effects).toEqual([])
})

test("a seek that goes on from the last hit wraps to the first", () => {
  const messages = [user("msg_u1", "**a**"), assistant("msg_a1", "**b**")]
  const text = createSearchText({ read: () => new Promise(() => {}), changed: () => {} })
  const matches = () => findMatchesInParts(text.parts(searchableSources(messages)), "**")

  const start = replay(
    [{ type: "move", delta: 2 }],
    opened({ type: "query.changed", value: "**", matches: matches() }).state,
  )
  text.rendered("msg_a1:text:0", "b")
  const read = transitionTimelineSearch(start.state, { type: "matches.read", sessionID: "ses_1", matches: matches() })
  expect(read.state).toMatchObject({ status: "seeking", activeIndex: 0 })
})

test("a switched session adopts its own matches and ignores the old session's sync", () => {
  const start = opened(typed("prompt"), { type: "move", delta: 3 })
  const other = [user("msg_x", "prompt here"), assistant("msg_y", "prompt there")]

  const switched = transitionTimelineSearch(start.state, {
    type: "session.changed",
    sessionID: "ses_2",
    matches: find(other, "prompt"),
  })

  expect(switched.state).toMatchObject({ status: "open", sessionID: "ses_2", value: "prompt", activeIndex: 0 })
  expect(timelineSearchView(switched.state)).toMatchObject({ activeDisplay: 1, count: 2 })

  const stale = transitionTimelineSearch(switched.state, synced(history, "prompt", "ses_1"))
  expect(stale.state).toBe(switched.state)
})

test("whitespace or casing changes keep the current match and its seek", () => {
  const start = opened(typed("Prompt"), { type: "move", delta: 2 })
  const result = transitionTimelineSearch(start.state, typed("prompt "))
  expect(result.state).toEqual({ ...seeking(start.state), value: "prompt " })
  expect(result.effects).toEqual([])
})

test("a closed Find bar ignores everything but open", () => {
  const closed = createTimelineSearchState()

  const events: TimelineSearchEvent[] = [
    { type: "close" },
    typed("prompt"),
    { type: "move", delta: 1 },
    { type: "session.changed", sessionID: "ses_2", matches: [] },
    synced(history),
    missing(0),
    folded(0),
    ready(0, 10),
    { type: "disposed" },
  ]

  for (const event of events) {
    const result = transitionTimelineSearch(closed, event)
    expect(result.state).toBe(closed)
    expect(result.effects).toEqual([])
  }

  expect(transitionTimelineSearch(closed, { type: "open", sessionID: "ses_1" }).effects).toEqual([
    { type: "focus-input" },
  ])
})

test("moving wraps around the matches", () => {
  const start = opened(typed("prompt"))
  expect(transitionTimelineSearch(start.state, { type: "move", delta: -1 }).state).toMatchObject({ activeIndex: 3 })
  expect(
    replay([{ type: "move", delta: 1 }], replay([{ type: "move", delta: 3 }], start.state).state).state,
  ).toMatchObject({ activeIndex: 0 })

  const single = opened(typed("shorter"))
  const again = transitionTimelineSearch(single.state, { type: "move", delta: 1 })
  expect(again.state).toMatchObject({ status: "seeking", activeIndex: 0, attempt: 2 })

  const none = opened(typed("missing"))
  expect(transitionTimelineSearch(none.state, { type: "move", delta: 1 }).state).toBe(none.state)
})

test("a match reveals the turn its user or shell message starts", () => {
  const matches = find(
    [user("msg_u", "prompt"), assistant("msg_a", "Prompt", "no"), shell("msg_s"), assistant("msg_b", "prompt prompt")],
    "PROMPT ",
  )

  expect(matches).toEqual([
    { revealID: "msg_u", partID: "msg_u:text:0", occurrence: 0 },
    { revealID: "msg_u", partID: "msg_a:text:0", occurrence: 0 },
    { revealID: "msg_s", partID: "msg_b:text:0", occurrence: 0 },
    { revealID: "msg_s", partID: "msg_b:text:0", occurrence: 1 },
  ])
})

test.each([
  { name: "closed", state: createTimelineSearchState(), visible: false, showCount: false, display: "0/0" },
  { name: "empty", state: opened().state, visible: true, showCount: false, display: "0/0" },
  { name: "without results", state: opened(typed("missing")).state, visible: true, showCount: true, display: "0/0" },
  { name: "seeking", state: opened(typed("prompt")).state, visible: true, showCount: true, display: "1/4" },
  {
    name: "settled",
    state: opened(typed("prompt"), ...landed(1, 0)).state,
    visible: true,
    showCount: true,
    display: "1/4",
  },
])("the view of a $name Find bar", ({ state, visible, showCount, display }) => {
  const view = timelineSearchView(state)
  expect(view.visible).toBe(visible)
  expect(view.showCount).toBe(showCount)
  expect(`${view.activeDisplay}/${view.count}`).toBe(display)
})
