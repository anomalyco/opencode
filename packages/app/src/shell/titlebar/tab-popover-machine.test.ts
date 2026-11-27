import { describe, expect, test } from "bun:test"
import {
  INITIAL_TAB_PREVIEW_STATE,
  selectTabPreviewInstant,
  selectTabPreviewOpenDelay,
  TAB_PREVIEW_OPEN_DELAY_MS,
  transitionTabPreview,
  type TabPreviewEffect,
  type TabPreviewEvent,
  type TabPreviewOwner,
  type TabPreviewState,
} from "./tab-popover-machine"

const owner = (): TabPreviewOwner => ({ close: () => {} })

const replay = (events: TabPreviewEvent[], state: TabPreviewState = INITIAL_TAB_PREVIEW_STATE) =>
  events.reduce<{ state: TabPreviewState; effects: TabPreviewEffect[] }>(
    (current, event) => {
      const next = transitionTabPreview(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

describe("tab preview", () => {
  test("a neighbouring tab takes over at once and closes the previous preview", () => {
    const a = owner()
    const b = owner()
    const open = replay([{ type: "preview.opened", owner: a }]).state
    expect(selectTabPreviewInstant(open)).toBe(false)
    expect(selectTabPreviewOpenDelay(open)).toBe(0)

    const handoff = transitionTabPreview(open, { type: "preview.opened", owner: b })
    expect(handoff.effects).toEqual([{ type: "owner.close", owner: a }])
    expect(selectTabPreviewInstant(handoff.state)).toBe(true)

    // The closed tab reports back; it no longer owns the preview.
    const stale = transitionTabPreview(handoff.state, { type: "preview.closed", owner: a })
    expect(stale.state).toBe(handoff.state)
    expect(stale.effects).toEqual([])
  })

  test("the warm window skips the open delay until it expires", () => {
    const b = owner()
    const c = owner()

    const warm = replay([
      { type: "preview.opened", owner: b },
      { type: "owner.disposed", owner: b },
    ])

    expect(warm.state).toEqual({ status: "warm", attempt: 1, instant: false })
    expect(selectTabPreviewOpenDelay(warm.state)).toBe(0)

    const reopened = transitionTabPreview(warm.state, { type: "preview.opened", owner: c })
    expect(reopened.effects).toEqual([{ type: "warm.clear" }])
    expect(selectTabPreviewInstant(reopened.state)).toBe(true)
    // The first window's timer fires late.
    expect(transitionTabPreview(reopened.state, { type: "warm.expired", attempt: 1 }).state).toBe(reopened.state)

    const rewarmed = transitionTabPreview(reopened.state, { type: "preview.closed", owner: c })
    expect(rewarmed.effects).toEqual([{ type: "warm.start", attempt: 2, delayMs: 500 }])
    expect(transitionTabPreview(rewarmed.state, { type: "warm.expired", attempt: 1 }).state).toBe(rewarmed.state)

    const cold = transitionTabPreview(rewarmed.state, { type: "warm.expired", attempt: 2 })
    expect(cold.state.status).toBe("cold")
    expect(selectTabPreviewOpenDelay(cold.state)).toBe(TAB_PREVIEW_OPEN_DELAY_MS)
    expect(selectTabPreviewInstant(cold.state)).toBe(false)
  })

  test("closes and disposals of a tab that is not showing change nothing", () => {
    const a = owner()
    const cold = INITIAL_TAB_PREVIEW_STATE
    expect(transitionTabPreview(cold, { type: "preview.closed", owner: a }).state).toBe(cold)
    expect(transitionTabPreview(cold, { type: "owner.disposed", owner: a }).state).toBe(cold)
    expect(transitionTabPreview(cold, { type: "warm.expired", attempt: 0 }).state).toBe(cold)
  })
})
