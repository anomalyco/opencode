import { describe, expect, test } from "bun:test"
import {
  initialSiteState,
  siteView,
  transitionSite,
  type SiteEvent,
  type SiteState,
  type SiteTransition,
} from "./site-machine"

// Folds the events in order and returns the last transition.
const replay = (events: readonly SiteEvent[], state: SiteState = initialSiteState) =>
  events.reduce<SiteTransition>((last, event) => transitionSite(last.state, event), { state, effects: [] })

// The popover opened and read 3 cookies with attempt 1.
const ready = () =>
  replay([
    { type: "open.changed", open: true },
    { type: "load.succeeded", attempt: 1, cookies: 3 },
  ]).state

describe("a failed read", () => {
  test("says so and offers a retry that reads again", () => {
    const failed = replay([
      { type: "open.changed", open: true },
      { type: "load.failed", attempt: 1 },
    ])

    expect(siteView(failed.state)).toMatchObject({
      open: true,
      failed: true,
      actionDisabled: false,
      cookies: undefined,
    })

    const retried = transitionSite(failed.state, { type: "retry" })
    expect(retried.effects).toEqual([{ type: "load", attempt: 2 }])
    expect(siteView(retried.state).actionDisabled).toBe(true)

    const loaded = transitionSite(retried.state, { type: "load.succeeded", attempt: 2, cookies: 4 })
    expect(siteView(loaded.state)).toMatchObject({ failed: false, cookies: 4, actionDisabled: false })
  })

  test("a read that never answers fails at its timeout", () => {
    const result = replay([
      { type: "open.changed", open: true },
      { type: "timeout", phase: "loading", attempt: 1 },
    ])

    expect(siteView(result.state).failed).toBe(true)
  })

  test("a read from an earlier opening is ignored", () => {
    const reopened = replay([
      { type: "open.changed", open: true },
      { type: "open.changed", open: false },
      { type: "open.changed", open: true },
    ]).state

    const stale = transitionSite(reopened, { type: "load.succeeded", attempt: 1, cookies: 9 })
    const late = transitionSite(reopened, { type: "timeout", phase: "loading", attempt: 1 })

    expect(stale.state).toBe(reopened)
    expect(late.state).toBe(reopened)
    expect(transitionSite(reopened, { type: "load.succeeded", attempt: 2, cookies: 2 }).state).toEqual({
      status: "ready",
      attempt: 2,
      cookies: 2,
    })
  })
})

describe("clearing", () => {
  test("hides the old count and disables the button until the next read", () => {
    const clearing = transitionSite(ready(), { type: "clear.clicked" })

    expect(clearing.effects).toEqual([{ type: "clear", attempt: 2 }])
    expect(siteView(clearing.state)).toMatchObject({ open: true, cookies: undefined, actionDisabled: true })
    expect(transitionSite(clearing.state, { type: "clear.clicked" }).state).toBe(clearing.state)

    const cleared = transitionSite(clearing.state, { type: "clear.succeeded", attempt: 2 })
    expect(cleared.effects).toEqual([{ type: "load", attempt: 3 }])
  })

  test("a failure tells the user and reads the count again", () => {
    const clearing = transitionSite(ready(), { type: "clear.clicked" }).state

    expect(transitionSite(clearing, { type: "clear.failed", attempt: 2 }).effects).toEqual([
      { type: "notify-clear-failed" },
      { type: "load", attempt: 3 },
    ])
    expect(transitionSite(clearing, { type: "timeout", phase: "clearing", attempt: 2 }).effects).toEqual([
      { type: "notify-clear-failed" },
      { type: "load", attempt: 3 },
    ])
  })

  test("closing the popover keeps the clear, and it settles without a read", () => {
    const closed = replay([{ type: "clear.clicked" }, { type: "open.changed", open: false }], ready())
    expect(siteView(closed.state).open).toBe(false)

    const settled = transitionSite(closed.state, { type: "clear.succeeded", attempt: 2 })
    expect(settled.state).toEqual({ status: "closed", attempt: 2 })
    expect(settled.effects).toEqual([])
  })

  test("reopening during the clear waits for it, then reads", () => {
    const reopened = replay(
      [{ type: "clear.clicked" }, { type: "open.changed", open: false }, { type: "open.changed", open: true }],
      ready(),
    )

    expect(reopened.effects).toEqual([])
    expect(siteView(reopened.state)).toMatchObject({ open: true, actionDisabled: true })

    expect(transitionSite(reopened.state, { type: "clear.succeeded", attempt: 2 }).effects).toEqual([
      { type: "load", attempt: 3 },
    ])
  })

  test("a clear that settles after the popover unmounted does nothing", () => {
    const disposed = replay([{ type: "clear.clicked" }, { type: "disposed" }], ready()).state

    const events: SiteEvent[] = [
      { type: "clear.failed", attempt: 2 },
      { type: "clear.succeeded", attempt: 2 },
      { type: "timeout", phase: "clearing", attempt: 2 },
      { type: "open.changed", open: true },
    ]

    events.forEach((event) => {
      const next = transitionSite(disposed, event)
      expect(next.state).toBe(disposed)
      expect(next.effects).toEqual([])
    })
  })
})

test("closing while reading drops the read", () => {
  const closed = replay([
    { type: "open.changed", open: true },
    { type: "open.changed", open: false },
  ]).state

  expect(closed).toEqual({ status: "closed", attempt: 1 })
  expect(transitionSite(closed, { type: "load.succeeded", attempt: 1, cookies: 3 }).state).toBe(closed)
})
