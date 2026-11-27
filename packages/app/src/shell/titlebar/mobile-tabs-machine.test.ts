import { describe, expect, test } from "bun:test"
import {
  INITIAL_MOBILE_TABS_STATE,
  MOBILE_TABS_CLOSE_TIMEOUT_MS,
  selectMobileTabsOpen,
  transitionMobileTabs,
  type MobileTabsEffect,
  type MobileTabsEvent,
  type MobileTabsState,
} from "./mobile-tabs-machine"

const replay = (events: MobileTabsEvent[], state = INITIAL_MOBILE_TABS_STATE) =>
  events.reduce<{ state: MobileTabsState; effects: MobileTabsEffect[] }>(
    (current, event) => {
      const next = transitionMobileTabs(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const opened: MobileTabsEvent = { type: "drawer.changed", open: true }

const closedByDrawer: MobileTabsEvent = { type: "drawer.changed", open: false }

const gone: MobileTabsEvent = { type: "content.present", present: false }

const settings: MobileTabsEvent = { type: "settings.requested" }

const opensSettings = (effects: MobileTabsEffect[]) =>
  effects.filter((effect) => effect.type === "settings.open").length

describe("mobile tabs drawer", () => {
  test("Settings opens once the drawer has slid out", () => {
    const closing = replay([opened, settings])
    expect(closing.state).toEqual({ status: "closing-to-settings", attempt: 1 })
    expect(closing.effects).toEqual([{ type: "timer.start", attempt: 1, timeoutMs: MOBILE_TABS_CLOSE_TIMEOUT_MS }])
    expect(selectMobileTabsOpen(closing.state)).toBe(false)

    // The drawer may report its own close while it slides out; Settings still waits for the end.
    const echoed = transitionMobileTabs(closing.state, closedByDrawer)
    expect(echoed.state).toBe(closing.state)

    const done = transitionMobileTabs(closing.state, gone)
    expect(done.state).toEqual({ status: "closed", attempt: 1 })
    expect(done.effects).toEqual([{ type: "timer.clear" }, { type: "settings.open" }])
  })

  test("reopening the drawer mid-close cancels Settings", () => {
    const result = replay([opened, settings, opened, closedByDrawer, gone])
    expect(result.effects).toContainEqual({ type: "timer.clear" })
    expect(opensSettings(result.effects)).toBe(0)
    expect(result.state.status).toBe("closed")
  })

  test("picking a tab or navigating mid-close cancels Settings", () => {
    for (const cancel of [{ type: "close" }, { type: "route.changed" }] satisfies MobileTabsEvent[]) {
      const result = replay([opened, settings, cancel, gone, { type: "close.timed-out", attempt: 1 }])
      expect(result.state.status).toBe("closed")
      expect(opensSettings(result.effects)).toBe(0)
    }
  })

  test("leaving the phone layout mid-close opens Settings at once", () => {
    const result = replay([opened, settings, { type: "viewport.changed", mobile: false }, gone])
    expect(result.state.status).toBe("closed")
    expect(opensSettings(result.effects)).toBe(1)
  })

  test("an exit that never ends opens Settings after the timeout, once", () => {
    const result = replay([opened, settings, { type: "close.timed-out", attempt: 1 }, gone])
    expect(opensSettings(result.effects)).toBe(1)

    // A later, unrelated close does not open Settings.
    expect(opensSettings(replay([opened, closedByDrawer, gone], result.state).effects)).toBe(0)
  })

  test("a timeout from an earlier Settings request is ignored", () => {
    const closing = replay([opened, settings, opened, settings]).state
    expect(closing).toEqual({ status: "closing-to-settings", attempt: 2 })
    expect(transitionMobileTabs(closing, { type: "close.timed-out", attempt: 1 }).state).toBe(closing)
  })

  test("route and viewport changes close an open drawer", () => {
    for (const event of [
      { type: "route.changed" },
      { type: "viewport.changed", mobile: false },
    ] satisfies MobileTabsEvent[]) {
      const result = replay([opened, event])
      expect(result.state).toEqual({ status: "closed", attempt: 0 })
      expect(result.effects).toEqual([])
    }

    const open = replay([opened]).state
    expect(transitionMobileTabs(open, { type: "viewport.changed", mobile: true }).state).toBe(open)
    expect(transitionMobileTabs(INITIAL_MOBILE_TABS_STATE, { type: "close" }).state).toBe(INITIAL_MOBILE_TABS_STATE)
  })

  test("disposing mid-close clears the timer and ignores later events", () => {
    const result = replay([opened, settings, { type: "disposed" }])
    expect(result.effects.at(-1)).toEqual({ type: "timer.clear" })
    expect(transitionMobileTabs(result.state, gone).effects).toEqual([])
    expect(transitionMobileTabs(result.state, { type: "close.timed-out", attempt: 1 }).effects).toEqual([])
  })
})
