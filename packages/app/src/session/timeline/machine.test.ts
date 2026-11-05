import { expect, test } from "bun:test"
import {
  createFollowState,
  createRouteRevealState,
  defersAdjustments,
  isFollowing,
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

const scroll = (scrollTop: number, previousTop: number, maxScroll = 1000, previousMaxScroll = maxScroll) =>
  ({ type: "scroll", scrollTop, previousTop, maxScroll, previousMaxScroll }) as const

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
    events: [{ type: "pointer.down" }, { type: "pointer.up" }, scroll(480, 500, 500, 520)],
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
    name: "resumes when the content shrinks to fit",
    events: [{ type: "detach" }, scroll(0, 300, 0, 300)],
    following: true,
  },
  {
    name: "keeps a revealed tool when reaching it lands at the end",
    events: [{ type: "anchor", anchor }, scroll(1000, 400)],
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
