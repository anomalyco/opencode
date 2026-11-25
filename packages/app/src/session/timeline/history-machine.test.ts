import { describe, expect, test } from "bun:test"
import {
  canRequestFillProbe,
  canRequestScrollPage,
  canSeekHistory,
  createTimelineHistoryState,
  DISPOSED_HISTORY_EVENT,
  FILL_REQUESTED_EVENT,
  historySeekStatus,
  SCROLL_TOP_EVENT,
  SEEK_REQUESTED_EVENT,
  transitionTimelineHistory,
  type HistoryTarget,
  type TimelineHistoryEffect,
  type TimelineHistoryEvent,
  type TimelineHistoryState,
} from "./history-machine"

const sessionA: HistoryTarget = { sessionKey: "dir:ses_a", sessionID: "ses_a" }

const sessionB: HistoryTarget = { sessionKey: "dir:ses_b", sessionID: "ses_b" }

// The oldest message of the newest page, before any older page loads.
const newestPage = "msg_0020"

// Built the way the driver's sync effect builds it.
const sync = (
  input: { target?: HistoryTarget; more?: boolean; following?: boolean; ready?: boolean; oldest?: string } = {},
) =>
  ({
    type: "sync",
    target: input.target ?? sessionA,
    ready: input.ready ?? true,
    more: input.more ?? true,
    following: input.following ?? false,
    oldest: input.oldest ?? newestPage,
  }) satisfies TimelineHistoryEvent

function replay(events: TimelineHistoryEvent[], from = createTimelineHistoryState()) {
  return events.reduce<{ state: TimelineHistoryState; effects: TimelineHistoryEffect[] }>(
    (acc, event) => {
      const next = transitionTimelineHistory(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

const attempt = (state: TimelineHistoryState) => state.attempt

// `oldest` is the oldest loaded message once the page settles; the newest page's is the one before it.
const loaded = (state: TimelineHistoryState, oldest: string, more = true, following = false) =>
  ({
    type: "page.loaded",
    attempt: attempt(state),
    previous: newestPage,
    oldest,
    more,
    following,
  }) satisfies TimelineHistoryEvent

const cooldownSettled = (state: TimelineHistoryState, following = false) =>
  ({ type: "cooldown.settled", attempt: attempt(state), following }) satisfies TimelineHistoryEvent

// A following session whose short transcript starts loading through the fill probe.
function fillLoading() {
  const entered = replay([sync({ following: true })]).state

  return transitionTimelineHistory(entered, { type: "probe.settled", attempt: attempt(entered), load: true })
}

function failedFill() {
  const loading = fillLoading().state

  return transitionTimelineHistory(loading, { type: "page.failed", attempt: attempt(loading) }).state
}

function expectIgnored(state: TimelineHistoryState, event: TimelineHistoryEvent) {
  const next = transitionTimelineHistory(state, event)

  expect(next.state).toBe(state)
  expect(next.effects).toEqual([])
}

describe("history machine", () => {
  test("a failed page stops the fill and seek loops and cools down scroll retries", () => {
    const loading = fillLoading()
    expect(loading.state.status).toBe("loading")
    expect(loading.effects).toEqual([{ type: "load.start", sessionID: "ses_a", attempt: attempt(loading.state) }])

    const failed = transitionTimelineHistory(loading.state, { type: "page.failed", attempt: attempt(loading.state) })
    expect(failed.state).toMatchObject({ status: "failed", coolingDown: true })
    expect(failed.effects).toEqual([{ type: "cooldown.start", attempt: attempt(failed.state) }])

    // The store's loading flag flips back while its cursor stays; that used to request the page again at once.
    for (const event of [sync({ following: true }), FILL_REQUESTED_EVENT, SEEK_REQUESTED_EVENT, SCROLL_TOP_EVENT])
      expectIgnored(failed.state, event)

    // The reader scrolled away meanwhile, so only their next scroll retries.
    const cooled = transitionTimelineHistory(failed.state, cooldownSettled(failed.state))
    expect(cooled.state).toMatchObject({ status: "failed", coolingDown: false })
    expect(cooled.effects).toEqual([])
    expectIgnored(cooled.state, SEEK_REQUESTED_EVENT)
    expectIgnored(cooled.state, sync())

    const retried = transitionTimelineHistory(cooled.state, SCROLL_TOP_EVENT)
    expect(retried.state.status).toBe("loading")
    expect(retried.effects).toEqual([{ type: "load.start", sessionID: "ses_a", attempt: attempt(retried.state) }])
  })

  test("a short, following view checks its fill once the cooldown ends, without a content change", () => {
    const failed = failedFill()
    const cooled = transitionTimelineHistory(failed, cooldownSettled(failed, true))

    expect(cooled.state).toMatchObject({ status: "idle", probe: "fill" })
    expect(cooled.effects).toEqual([{ type: "probe.schedule", probe: "fill", attempt: attempt(cooled.state) }])

    const retried = transitionTimelineHistory(cooled.state, {
      type: "probe.settled",
      attempt: attempt(cooled.state),
      load: true,
    })

    expect(retried.effects).toEqual([{ type: "load.start", sessionID: "ses_a", attempt: attempt(retried.state) }])
  })

  test("a content change retries a cooled-down failure through one fill probe", () => {
    const failed = failedFill()
    const cooled = transitionTimelineHistory(failed, cooldownSettled(failed)).state

    const probing = transitionTimelineHistory(cooled, FILL_REQUESTED_EVENT)
    expect(probing.state).toMatchObject({ status: "idle", probe: "fill" })
    expect(probing.effects).toEqual([{ type: "probe.schedule", probe: "fill", attempt: attempt(probing.state) }])
    expect(canRequestFillProbe(probing.state)).toBe(false)
  })

  test("a page that adds nothing while the cursor stays stops paging", () => {
    const loading = fillLoading().state
    const stalled = transitionTimelineHistory(loading, loaded(loading, newestPage, true, true))

    expect(stalled.state).toMatchObject({ status: "exhausted", stalled: { oldest: newestPage } })
    expect(stalled.effects).toEqual([])

    for (const event of [sync({ following: true }), FILL_REQUESTED_EVENT, SEEK_REQUESTED_EVENT, SCROLL_TOP_EVENT])
      expectIgnored(stalled.state, event)
  })

  test("a resync or reload after a stalled page starts paging again", () => {
    const loading = replay([sync(), SCROLL_TOP_EVENT]).state
    const stalled = transitionTimelineHistory(loading, loaded(loading, newestPage)).state

    // The resynced newest page starts at a newer message, with a cursor again.
    const resynced = transitionTimelineHistory(stalled, sync({ oldest: "msg_0040" }))
    expect(resynced.state).toEqual({ status: "idle", target: sessionA, attempt: attempt(stalled) + 1 })
    expect(transitionTimelineHistory(resynced.state, SCROLL_TOP_EVENT).state.status).toBe("loading")

    const following = transitionTimelineHistory(stalled, sync({ oldest: "msg_0040", following: true }))
    expect(following.effects).toEqual([{ type: "probe.schedule", probe: "fill", attempt: attempt(following.state) }])
  })

  test("a resync that replaces the transcript during a load counts as progress, not a stall", () => {
    const loading = replay([sync(), SCROLL_TOP_EVENT]).state
    const replaced = transitionTimelineHistory(loading, loaded(loading, "msg_0040"))

    expect(replaced.state).toMatchObject({ status: "idle", probe: "top" })
  })

  test("a session switch aborts the previous load and ignores its late results", () => {
    const loading = replay([sync(), SCROLL_TOP_EVENT]).state
    const switched = transitionTimelineHistory(loading, sync({ target: sessionB }))

    expect(switched.state).toEqual({ status: "idle", target: sessionB, attempt: attempt(loading) + 1 })
    expect(switched.effects).toEqual([{ type: "load.abort" }])

    expectIgnored(switched.state, loaded(loading, "msg_0000"))
    expectIgnored(switched.state, { type: "page.failed", attempt: attempt(loading) })
    expectIgnored(switched.state, { type: "page.timed-out", attempt: attempt(loading) })
  })

  test("a session switch cancels a pending probe and drops its result", () => {
    const probing = replay([sync({ following: true })]).state
    const switched = transitionTimelineHistory(probing, sync({ target: sessionB, following: true }))

    expect(switched.effects).toEqual([
      { type: "probe.cancel" },
      { type: "probe.schedule", probe: "fill", attempt: attempt(switched.state) },
    ])
    expectIgnored(switched.state, { type: "probe.settled", attempt: attempt(probing), load: true })
  })

  test("scrolling to the top while another load is in flight still requests a page", () => {
    // The store reports loading while the leading-turn backfill runs; the machine does not read it.
    const idle = replay([sync()]).state
    const loading = transitionTimelineHistory(idle, SCROLL_TOP_EVENT)

    expect(loading.state.status).toBe("loading")
    expect(loading.effects).toEqual([{ type: "load.start", sessionID: "ses_a", attempt: attempt(loading.state) }])
  })

  test("a prepend keeps paging while the detached view is still near the top", () => {
    const loading = replay([sync(), SCROLL_TOP_EVENT]).state
    const prepended = transitionTimelineHistory(loading, loaded(loading, "msg_0000"))

    expect(prepended.state).toMatchObject({ status: "idle", probe: "top" })
    expect(prepended.effects).toEqual([{ type: "probe.schedule", probe: "top", attempt: attempt(prepended.state) }])

    const settled = (load: boolean) =>
      transitionTimelineHistory(prepended.state, { type: "probe.settled", attempt: attempt(prepended.state), load })

    expect(settled(true).state.status).toBe("loading")

    const rested = settled(false)
    expect(rested.state).toEqual({ status: "idle", target: sessionA, attempt: attempt(prepended.state) })
    expect(rested.effects).toEqual([])
  })

  test("a following view probes the fill again after a prepend", () => {
    const loading = fillLoading().state
    const prepended = transitionTimelineHistory(loading, loaded(loading, "msg_0000", true, true))

    expect(prepended.effects).toEqual([{ type: "probe.schedule", probe: "fill", attempt: attempt(prepended.state) }])
  })

  test("a page that hangs times out, aborts and ignores its late result", () => {
    const loading = replay([sync(), SCROLL_TOP_EVENT]).state
    const timedOut = transitionTimelineHistory(loading, { type: "page.timed-out", attempt: attempt(loading) })

    expect(timedOut.state).toMatchObject({ status: "failed", coolingDown: true })
    expect(timedOut.effects).toEqual([
      { type: "load.abort" },
      { type: "cooldown.start", attempt: attempt(timedOut.state) },
    ])
    expectIgnored(timedOut.state, loaded(loading, "msg_0000"))
  })

  test("the last page exhausts history until the transcript has a cursor again", () => {
    const loading = replay([sync(), SCROLL_TOP_EVENT]).state
    const exhausted = transitionTimelineHistory(loading, loaded(loading, "msg_0000", false))

    expect(exhausted.state).toEqual({ status: "exhausted", target: sessionA, attempt: attempt(loading) + 1 })
    expectIgnored(exhausted.state, SCROLL_TOP_EVENT)
    expectIgnored(exhausted.state, sync({ more: false }))

    const reloaded = transitionTimelineHistory(exhausted.state, sync({ following: true }))
    expect(reloaded.state).toMatchObject({ status: "idle", probe: "fill" })
    expect(reloaded.effects).toEqual([{ type: "probe.schedule", probe: "fill", attempt: attempt(reloaded.state) }])
  })

  test("a session without older messages starts exhausted", () => {
    const entered = transitionTimelineHistory(createTimelineHistoryState(), sync({ more: false, following: true }))

    expect(entered.state).toEqual({ status: "exhausted", target: sessionA, attempt: 1 })
    expect(entered.effects).toEqual([])
  })

  test("steady scroll and unchanged syncs keep the same state", () => {
    const idle = replay([sync()]).state
    expectIgnored(idle, sync())

    const loading = transitionTimelineHistory(idle, SCROLL_TOP_EVENT).state
    expectIgnored(loading, SCROLL_TOP_EVENT)
    expectIgnored(loading, SEEK_REQUESTED_EVENT)
    expectIgnored(loading, FILL_REQUESTED_EVENT)
    expectIgnored(loading, sync({ following: true }))
  })

  test("leaving the session or disposing releases the active work", () => {
    const loading = replay([sync(), SCROLL_TOP_EVENT]).state
    const left = transitionTimelineHistory(loading, sync({ ready: false }))
    expect(left.state).toEqual({ status: "inactive", attempt: attempt(loading) + 1 })
    expect(left.effects).toEqual([{ type: "load.abort" }])
    expectIgnored(left.state, SCROLL_TOP_EVENT)
    expectIgnored(left.state, DISPOSED_HISTORY_EVENT)

    const failed = transitionTimelineHistory(loading, { type: "page.failed", attempt: attempt(loading) }).state
    const disposed = transitionTimelineHistory(failed, DISPOSED_HISTORY_EVENT)
    expect(disposed.state.status).toBe("inactive")
    expect(disposed.effects).toEqual([{ type: "cooldown.cancel" }])
    expectIgnored(disposed.state, cooldownSettled(failed, true))

    const probing = replay([sync({ following: true })]).state
    expect(transitionTimelineHistory(probing, DISPOSED_HISTORY_EVENT).effects).toEqual([{ type: "probe.cancel" }])
  })

  test("selectors gate the scroll, fill and seek requests by phase", () => {
    const idle = replay([sync()]).state
    const loading = transitionTimelineHistory(idle, SCROLL_TOP_EVENT).state
    const failed = transitionTimelineHistory(loading, { type: "page.failed", attempt: attempt(loading) }).state

    expect([idle, loading, failed].map(canRequestScrollPage)).toEqual([true, false, false])
    expect([idle, loading, failed].map(canRequestFillProbe)).toEqual([true, false, false])
    expect([idle, loading, failed].map(canSeekHistory)).toEqual([true, false, false])

    const exhausted = replay([sync({ more: false })]).state
    expect([createTimelineHistoryState(), idle, loading, failed, exhausted].map(historySeekStatus)).toEqual([
      "loading",
      "seekable",
      "loading",
      "failed",
      "exhausted",
    ])
  })
})
