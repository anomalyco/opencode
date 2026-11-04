import { describe, expect, test } from "bun:test"
import {
  ACTIVATED,
  CHECK_REQUESTED,
  coldMountFlushing,
  coldMountHidden,
  coldMountTailOnly,
  createColdMountState,
  DEACTIVATED,
  DISPOSED,
  SIZES_FLUSHED,
  SIZES_FLUSHING,
  transitionColdMount,
  type ColdMountEvent,
  type ColdMountSample,
  type ColdMountState,
  type ColdMountTransition,
} from "./cold-mount"

function run(state: ColdMountState, ...events: ColdMountEvent[]) {
  return events.reduce<ColdMountTransition>((result, event) => transitionColdMount(result.state, event), {
    state,
    effects: [],
  })
}

function check(attempt: number, sample: ColdMountSample): ColdMountEvent[] {
  return [CHECK_REQUESTED, { type: "check.ready", attempt }, { type: "check.sampled", attempt, sample }]
}

const mounted = run(createColdMountState(true), { type: "mounted", active: true }).state

describe("cold mount", () => {
  test("a warm mount starts revealed and ignores every event", () => {
    const state = createColdMountState(false)
    expect(coldMountHidden(state)).toBe(false)

    for (const event of [
      { type: "mounted", active: true },
      CHECK_REQUESTED,
      SIZES_FLUSHING,
      { type: "timeout", attempt: 1 },
      DISPOSED,
    ] satisfies ColdMountEvent[]) {
      const next = transitionColdMount(state, event)
      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    }
  })

  test("measures the tail, expands, then reveals on a settled pass", () => {
    const start = transitionColdMount(createColdMountState(true), { type: "mounted", active: true })
    expect(start.state).toMatchObject({ type: "measuring-tail", attempt: 1, checking: true })
    expect(start.effects).toEqual([
      { type: "observe" },
      { type: "timer.start", attempt: 1 },
      { type: "check.schedule", attempt: 1 },
    ])
    expect(coldMountTailOnly(start.state)).toBe(true)

    expect(transitionColdMount(start.state, { type: "check.ready", attempt: 1 }).effects).toEqual([
      { type: "check.sample", attempt: 1 },
    ])

    // The tail pass expands as soon as the view is pinned, as before, and checks the full range again.
    const expanded = transitionColdMount(start.state, { type: "check.sampled", attempt: 1, sample: "pinned" })
    expect(expanded.state).toMatchObject({ type: "expanding", checking: true })
    expect(expanded.effects).toEqual([{ type: "check.schedule", attempt: 1 }])
    expect(coldMountTailOnly(expanded.state)).toBe(false)
    expect(coldMountHidden(expanded.state)).toBe(true)

    // A pin that exposed rows still measuring waits for their sizes before revealing.
    const exposed = run(
      expanded.state,
      { type: "check.ready", attempt: 1 },
      { type: "check.sampled", attempt: 1, sample: "pinned" },
    )

    expect(exposed.state).toMatchObject({ type: "expanding", checking: false })
    expect(exposed.effects).toEqual([])

    const shown = run(exposed.state, ...check(1, "settled"))
    expect(shown.state).toEqual({ type: "revealed" })
    expect(shown.effects).toEqual([{ type: "release" }, { type: "reveal" }])
  })

  // Before the machine, a Markdown block that never set data-markdown-ready (or a view that stayed detached) kept
  // every pass returning early, and the timeline stayed invisible with nothing left to reveal it.
  test.each(["measuring-tail", "expanding"] as const)(
    "the fallback timer reveals a %s view whose checks keep waiting",
    (phase) => {
      const start = phase === "expanding" ? run(mounted, ...check(1, "pinned")).state : mounted
      const stuck = run(start, ...check(1, "waiting"), ...check(1, "waiting"), ...check(1, "waiting"))
      expect(stuck.state).toMatchObject({ type: phase, checking: false })
      expect(coldMountHidden(stuck.state)).toBe(true)

      const next = transitionColdMount(stuck.state, { type: "timeout", attempt: 1 })
      expect(next.state).toEqual({ type: "revealed" })
      expect(next.effects).toEqual([{ type: "release" }, { type: "pin" }, { type: "reveal" }])
      expect(transitionColdMount(next.state, CHECK_REQUESTED).state).toBe(next.state)
    },
  )

  test("joins check requests while one is running", () => {
    const next = transitionColdMount(mounted, CHECK_REQUESTED)
    expect(next.state).toBe(mounted)
    expect(next.effects).toEqual([])
  })

  test("ignores checks and timers from before a deactivation", () => {
    const hidden = transitionColdMount(mounted, DEACTIVATED)
    expect(hidden.state).toMatchObject({ active: false, checking: false })
    expect(hidden.effects).toEqual([{ type: "timer.cancel" }])

    for (const event of [
      CHECK_REQUESTED,
      { type: "check.ready", attempt: 1 },
      { type: "check.sampled", attempt: 1, sample: "settled" },
      { type: "timeout", attempt: 1 },
    ] satisfies ColdMountEvent[])
      expect(transitionColdMount(hidden.state, event).state).toBe(hidden.state)

    const shown = transitionColdMount(hidden.state, ACTIVATED)
    expect(shown.state).toMatchObject({ attempt: 2, active: true, checking: true })
    expect(shown.effects).toEqual([
      { type: "timer.start", attempt: 2 },
      { type: "check.schedule", attempt: 2 },
    ])

    // The first activation's microtask and timer arrive late, and only the current attempt's count.
    for (const event of [
      { type: "check.ready", attempt: 1 },
      { type: "timeout", attempt: 1 },
    ] satisfies ColdMountEvent[])
      expect(transitionColdMount(shown.state, event).state).toBe(shown.state)
    expect(transitionColdMount(shown.state, { type: "timeout", attempt: 2 }).state).toEqual({ type: "revealed" })
  })

  test("an inactive mount observes but neither checks nor times out until activated", () => {
    const next = transitionColdMount(createColdMountState(true), { type: "mounted", active: false })
    expect(next.state).toMatchObject({ attempt: 1, active: false, checking: false })
    expect(next.effects).toEqual([{ type: "observe" }])
    expect(transitionColdMount(next.state, CHECK_REQUESTED).effects).toEqual([])
    expect(transitionColdMount(next.state, ACTIVATED).effects).toEqual([
      { type: "timer.start", attempt: 2 },
      { type: "check.schedule", attempt: 2 },
    ])
  })

  test("holds per-row scroll writes only while a hidden size commit runs", () => {
    const flushing = transitionColdMount(mounted, SIZES_FLUSHING).state
    expect(coldMountFlushing(flushing)).toBe(true)
    expect(coldMountFlushing(transitionColdMount(flushing, SIZES_FLUSHED).state)).toBe(false)
    expect(coldMountFlushing(transitionColdMount(flushing, DISPOSED).state)).toBe(false)
  })

  test("disposal releases the observers and timer", () => {
    const next = transitionColdMount(run(mounted, ...check(1, "pinned")).state, DISPOSED)
    expect(next.state).toEqual({ type: "revealed" })
    expect(next.effects).toEqual([{ type: "release" }])
  })
})
