import { expect, test } from "bun:test"
import {
  CONTACT_LOST_EVENT,
  createFollowState,
  createRouteRevealState,
  defersAdjustments,
  isFollowing,
  isTouchHeld,
  needsEndProbe,
  ROUTE_REVEAL_HISTORY_LIMIT,
  routeRevealTarget,
  transitionFollow,
  transitionRouteReveal,
  type FollowEvent,
  type FollowState,
  type RouteRevealEvent,
} from "./machine"

const replay = (events: FollowEvent[], from = createFollowState()) => events.reduce(transitionFollow, from)

// The reader made the whole movement, unless `reader` says how much of it.
const scroll = (
  scrollTop: number,
  previousTop: number,
  maxScroll = 1000,
  previousMaxScroll = maxScroll,
  reader = scrollTop - previousTop,
) => ({ type: "scroll", scrollTop, previousTop, maxScroll, previousMaxScroll, reader }) as const

const anchor = { key: "assistant-part:tool", partID: "prt_tool" }

test.each<{ name: string; events: FollowEvent[]; following: boolean }>([
  {
    // Navigating or selecting in a transcript that does not overflow yet used to keep following, so the content
    // growing past the viewport scrolled the target away.
    name: "detaches without overflow and stays detached while the content grows",
    events: [{ type: "detach" }, scroll(0, 0, 0, 0)],
    following: false,
  },
  {
    name: "holds a revealed tool without overflow",
    events: [{ type: "anchor", anchor }, scroll(0, 0, 0, 0)],
    following: false,
  },
  {
    name: "ignores upward wheel, key and drag over content that does not overflow",
    events: [
      { type: "scroll.intent", upward: true, overflow: false },
      { type: "touch.start", nested: false },
      { type: "touch.drag", overflow: false },
    ],
    following: true,
  },
  {
    // A pointer released outside the window, or after it lost focus, used to stay held, so the next upward
    // adjustment from the virtualizer stopped following.
    name: "keeps following after a pointer the window lost, then an automatic upward scroll",
    events: [{ type: "pointer.down" }, { type: "pointer.up" }, scroll(480, 500, 500, 520, 0)],
    following: true,
  },
  {
    // Ctrl+Home, PageUp on a control in a row, a scrollbar drag and toggled autoscroll scroll without any event the
    // timeline handles, so it kept following and the next size change pulled the reader back to the end.
    name: "detaches when the reader scrolls up by any means",
    events: [scroll(480, 500)],
    following: false,
  },
  {
    // Autoscroll starts slowly, and a reply that streams pins the view back between its scrolls.
    name: "adds up a slow upward scroll across the pins of a streaming reply",
    events: [scroll(997, 1000), scroll(1027, 997, 1030, 1000, -3)],
    following: false,
  },
  {
    name: "keeps following through upward movement too small to tell from a zoomed range's rounding",
    events: [scroll(997, 1000), { type: "scroll.settled", atReachableEnd: false }, scroll(997, 1000)],
    following: true,
  },
  {
    // The size compensation and the clamp to a shorter range move the offset up as well.
    name: "keeps following when the timeline's own writes or a shorter range move the view up",
    events: [scroll(700, 1000, 1000, 1000, 0), scroll(400, 700, 400, 1000, 0)],
    following: true,
  },
  {
    name: "keeps a queued return when a scroll still in motion moves up before its frame",
    events: [{ type: "return.start", attempt: 1 }, scroll(480, 500), { type: "return.run", attempt: 1 }],
    following: true,
  },
  {
    name: "detaches when a held pointer scrolls up, as a drag-select or scrollbar drag does",
    events: [{ type: "pointer.down" }, scroll(480, 500), { type: "pointer.up" }],
    following: false,
  },
  {
    name: "lets a nested scrollport own a touch drag",
    events: [
      { type: "touch.start", nested: true },
      { type: "touch.drag", overflow: true },
      { type: "touch.end", scrolling: false },
    ],
    following: true,
  },
  {
    name: "detaches when a nested touch chains into the timeline",
    events: [{ type: "touch.start", nested: true }, scroll(480, 500)],
    following: false,
  },
  {
    name: "detaches when touch momentum scrolls up after the finger lifts",
    events: [{ type: "touch.start", nested: true }, { type: "touch.end", scrolling: true }, scroll(480, 500)],
    following: false,
  },
  {
    name: "drops a queued return when the reader scrolls up before its frame",
    events: [
      { type: "return.start", attempt: 1 },
      { type: "scroll.intent", upward: true, overflow: true },
      { type: "return.run", attempt: 1 },
    ],
    following: false,
  },
  {
    name: "resumes by arriving at the end",
    events: [{ type: "scroll.intent", upward: true, overflow: true }, scroll(400, 500), scroll(1000, 400)],
    following: true,
  },
  {
    // The timeline writes the end, and the reader's wheel leaves it before that write's scroll event arrives. The
    // event counted as the reader's return: the timeline followed again for a frame and cleared the route's hash.
    name: "stays detached when the scroll event of the timeline's own write to the end arrives after a wheel up",
    events: [{ type: "scroll.intent", upward: true, overflow: true }, scroll(1000, 940, 1000, 1000, 0)],
    following: false,
  },
  {
    // A reply streaming at the tail moved the end away while the wheel was on its way there, so the scroll landed a
    // line short and the reader never rejoined it.
    name: "rejoins the end when a downward wheel lands within reach of it",
    events: [
      { type: "scroll.intent", upward: true, overflow: true },
      scroll(400, 500),
      { type: "scroll.intent", upward: false, overflow: false },
      scroll(1000, 400, 1064, 1000),
    ],
    following: true,
  },
  {
    name: "stays detached when a downward wheel stops out of reach of the end",
    events: [{ type: "detach" }, { type: "scroll.intent", upward: false, overflow: false }, scroll(900, 400)],
    following: false,
  },
  {
    name: "stays detached when the reader scrolls down within reach of the end after an upward wheel",
    events: [{ type: "scroll.intent", upward: true, overflow: true }, scroll(940, 1000), scroll(960, 940)],
    following: false,
  },
  {
    // A size correction moves the offset down too, without the reader.
    name: "stays detached when a size correction moves the view within reach of the end after a downward wheel",
    events: [
      { type: "detach" },
      { type: "scroll.intent", upward: false, overflow: false },
      scroll(600, 400),
      scroll(960, 600, 1000, 1000, 0),
    ],
    following: false,
  },
  {
    // A link or Find that lands near the end shows its target there, which following would scroll away.
    name: "stays detached when navigation lands within reach of the end after a downward wheel",
    events: [
      { type: "detach" },
      { type: "scroll.intent", upward: false, overflow: false },
      scroll(600, 400),
      { type: "detach" },
      scroll(960, 600),
    ],
    following: false,
  },
  {
    // A cold link to a message detached, then the rows' real sizes shortened the scroll range to where the view
    // was. That counted as arriving at the end, so the link was dropped and the session opened on its latest message.
    name: "stays where navigation sent the view when a shrinking scroll range clamps it to the end",
    events: [{ type: "detach" }, scroll(987, 1380, 987, 1380, 0)],
    following: false,
  },
  {
    name: "stays where navigation sent the view when a shrinking scroll range clamps it to the zoomed end",
    events: [{ type: "detach" }, scroll(984, 1380, 987, 1380, 0), { type: "scroll.settled", atReachableEnd: true }],
    following: false,
  },
  {
    // At the end a wheel toward it scrolls nothing, so a reader the clamp left detached there had no way back.
    name: "resumes when a shrinking scroll range clamps a reader who scrolled away to the end",
    events: [
      { type: "scroll.intent", upward: true, overflow: true },
      scroll(940, 1000),
      scroll(900, 940, 900, 1000, 0),
    ],
    following: true,
  },
  {
    name: "resumes at a clamp once a wheel or key has scrolled on from where navigation sent the view",
    events: [
      { type: "detach" },
      { type: "scroll.intent", upward: true, overflow: true },
      scroll(940, 1000),
      scroll(900, 940, 900, 1000, 0),
    ],
    following: true,
  },
  {
    name: "resumes at a clamp once a touch has scrolled on from where navigation sent the view",
    events: [
      { type: "detach" },
      { type: "touch.start", nested: false },
      scroll(940, 1000),
      { type: "touch.end", scrolling: false },
      scroll(900, 940, 900, 1000, 0),
    ],
    following: true,
  },
  {
    name: "resumes when the content shrinks to fit",
    events: [{ type: "detach" }, scroll(0, 300, 0, 300, 0)],
    following: true,
  },
  {
    name: "keeps a revealed tool when reaching it lands at the end",
    events: [{ type: "anchor", anchor }, scroll(1000, 400, 1000, 1000, 0)],
    following: false,
  },
  {
    name: "resumes at a zoomed end once the scroll settles there",
    events: [{ type: "detach" }, scroll(997, 900), { type: "scroll.settled", atReachableEnd: true }],
    following: true,
  },
  {
    name: "stays detached when a nudge up cancels a pending zoomed end",
    events: [
      { type: "detach" },
      scroll(997, 900),
      scroll(996.8, 997),
      { type: "scroll.settled", atReachableEnd: true },
    ],
    following: false,
  },
])("$name", (input) => {
  expect(isFollowing(replay(input.events))).toBe(input.following)
})

test("a newer return supersedes a queued one", () => {
  const queued = replay([
    { type: "return.start", attempt: 1 },
    { type: "detach" },
    { type: "return.start", attempt: 2 },
  ])

  expect(transitionFollow(queued, { type: "return.run", attempt: 1 })).toBe(queued)
  expect(transitionFollow(queued, { type: "return.run", attempt: 2 })).toEqual({ type: "following" })
})

test("only the reader's own input lets a revealed tool go", () => {
  const anchored = replay([{ type: "anchor", anchor }])

  const kept: FollowEvent[] = [
    { type: "detach" },
    { type: "pointer.up" },
    { type: "touch.drag", overflow: true },
    scroll(1000, 400),
    { type: "scroll.settled", atReachableEnd: true },
  ]

  const released: FollowEvent[] = [
    { type: "scroll.intent", upward: false, overflow: false },
    { type: "pointer.down" },
    { type: "touch.start", nested: false },
    { type: "release" },
  ]

  kept.forEach((event) => expect(transitionFollow(anchored, event)).toBe(anchored))
  released.forEach((event) => expect(transitionFollow(anchored, event).type).toBe("detached"))
})

test("probes a zoomed end only once the finger lifts", () => {
  const held = replay([
    { type: "touch.start", nested: false },
    { type: "touch.drag", overflow: true },
    scroll(997, 900),
  ])

  expect(needsEndProbe(held)).toBe(false)
  expect(transitionFollow(held, { type: "scroll.settled", atReachableEnd: true })).toBe(held)
  expect(needsEndProbe(transitionFollow(held, { type: "touch.end", scrolling: false }))).toBe(true)
})

test("defers size compensation through detached touch momentum until the scroll settles", () => {
  const momentum = replay([
    { type: "touch.start", nested: false },
    { type: "touch.drag", overflow: true },
    { type: "touch.end", scrolling: true },
  ])

  expect(defersAdjustments(momentum)).toBe(true)
  expect(defersAdjustments(transitionFollow(momentum, { type: "scroll.settled", atReachableEnd: false }))).toBe(false)
  expect(defersAdjustments(replay([{ type: "touch.start", nested: false }]))).toBe(false)
})

test("revealing a tool mid-touch lets go of the finger, so the deferred translation flushes", () => {
  const held = replay([{ type: "touch.start", nested: false }])
  expect(isTouchHeld(held)).toBe(true)

  const anchored = transitionFollow(held, { type: "anchor", anchor })
  expect(isTouchHeld(anchored)).toBe(false)
  expect(defersAdjustments(anchored)).toBe(false)
})

// A blur, hidden tab or deactivated view never delivers touchend. The blur used to report only a pointer release, so
// the touch stayed held: the translation never flushed, the end probe never ran and a later pointer press was ignored.
test("losing contact mid-touch ends the touch", () => {
  const lost = transitionFollow(
    replay([
      { type: "touch.start", nested: false },
      { type: "touch.drag", overflow: true },
    ]),
    CONTACT_LOST_EVENT,
  )

  expect(lost).toEqual({ type: "detached", endPending: false })
  expect(isTouchHeld(lost)).toBe(false)
  expect(defersAdjustments(lost)).toBe(false)
  expect(transitionFollow(lost, { type: "pointer.down" })).toEqual({
    type: "detached",
    gesture: "pointer",
    endPending: false,
  })
})

test("losing contact keeps a pending zoomed end and probes it at once", () => {
  const held = replay([
    { type: "touch.start", nested: false },
    { type: "touch.drag", overflow: true },
    scroll(997, 900),
  ])

  const lost = transitionFollow(held, CONTACT_LOST_EVENT)

  expect(needsEndProbe(held)).toBe(false)
  expect(needsEndProbe(lost)).toBe(true)
})

test("losing contact ends touch momentum and a held pointer", () => {
  const momentum = replay([
    { type: "touch.start", nested: false },
    { type: "touch.drag", overflow: true },
    { type: "touch.end", scrolling: true },
  ])

  expect(defersAdjustments(transitionFollow(momentum, CONTACT_LOST_EVENT))).toBe(false)
  expect(transitionFollow(replay([{ type: "pointer.down" }]), CONTACT_LOST_EVENT)).toEqual({ type: "following" })
})

test.each<{ name: string; state: FollowState }>([
  { name: "following", state: createFollowState() },
  { name: "detached", state: replay([{ type: "detach" }]) },
  { name: "returning", state: replay([{ type: "return.start", attempt: 1 }]) },
  { name: "anchored", state: replay([{ type: "anchor", anchor }]) },
])("losing contact without any returns the same $name state", (input) => {
  expect(transitionFollow(input.state, CONTACT_LOST_EVENT)).toBe(input.state)
})

test.each<{ name: string; state: FollowState; event: FollowEvent }>([
  { name: "following", state: createFollowState(), event: scroll(1000, 990) },
  { name: "detached", state: replay([{ type: "detach" }]), event: scroll(200, 300) },
  { name: "anchored", state: replay([{ type: "anchor", anchor }]), event: scroll(200, 300) },
  { name: "settled following", state: createFollowState(), event: { type: "scroll.settled", atReachableEnd: false } },
])("a steady $name scroll returns the same state", (input) => {
  expect(transitionFollow(input.state, input.event)).toBe(input.state)
})

const reveal = (events: RouteRevealEvent[]) => events.reduce(transitionRouteReveal, createRouteRevealState())

const synced = (entryKey: string, target: string | undefined) => ({ type: "route.synced", entryKey, target }) as const

const attempted = (entryKey: string) => ({ type: "reveal.attempted", entryKey }) as const

test.each<{ name: string; events: RouteRevealEvent[]; pending?: { entryKey: string; target: string } }>([
  {
    // A tool call that is not in the list was looked for again on every reattach.
    name: "a missing tool call is attempted once per history entry",
    events: [synced("k1", "sh_missing"), attempted("k1"), synced("k1", "sh_missing")],
  },
  {
    // Only the last entry was remembered, so going Back revealed the first entry's tool again.
    name: "going Back to an entry already revealed does not reveal it again",
    events: [synced("k1", "sh_1"), attempted("k1"), synced("k2", "sh_2"), attempted("k2"), synced("k1", "sh_1")],
  },
  {
    name: "navigating away before the attempt drops the reveal without consuming it",
    events: [synced("k1", "sh_1"), synced("k2", undefined), synced("k1", "sh_1")],
    pending: { entryKey: "k1", target: "sh_1" },
  },
  {
    name: "an attempt for another entry leaves the pending reveal",
    events: [synced("k2", "sh_2"), attempted("k1")],
    pending: { entryKey: "k2", target: "sh_2" },
  },
])("$name", (input) => {
  const target = routeRevealTarget(reveal(input.events))

  expect(target && { entryKey: target.entryKey, target: target.target }).toEqual(input.pending)
})

test("a route reveal remembers only the latest entries it attempted", () => {
  const keys = Array.from({ length: ROUTE_REVEAL_HISTORY_LIMIT + 1 }, (_, index) => `k${index}`)
  const state = reveal(keys.flatMap((key) => [synced(key, "sh"), attempted(key)]))

  expect(routeRevealTarget(transitionRouteReveal(state, synced("k0", "sh")))).toBeDefined()
  expect(routeRevealTarget(transitionRouteReveal(state, synced("k1", "sh")))).toBeUndefined()
})
