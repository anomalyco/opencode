import { describe, expect, test } from "bun:test"
import {
  INITIAL_TAB_PREVIEW_STATE,
  selectTabPreviewFollowCard,
  selectTabPreviewInstant,
  selectTabPreviewOpenDelay,
  TAB_PREVIEW_OPEN_DELAY_MS,
  transitionTabPreview,
  type TabPreviewEffect,
  type TabPreviewEvent,
  type TabPreviewOwner,
  type TabPreviewState,
} from "./tab-popover-machine"

type El = { readonly id: string }

const owner = (): TabPreviewOwner => ({ close: () => {} })

const el = (id: string): El => ({ id })

const replay = (events: TabPreviewEvent<El>[], state: TabPreviewState<El> = INITIAL_TAB_PREVIEW_STATE) =>
  events.reduce<{ state: TabPreviewState<El>; effects: TabPreviewEffect<El>[] }>(
    (current, event) => {
      const next = transitionTabPreview(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const attach = (by: TabPreviewOwner, trigger: El, card: El, reducedMotion = false): TabPreviewEvent<El> => ({
  type: "follow.attached",
  owner: by,
  trigger,
  card,
  reducedMotion,
})

describe("tab preview", () => {
  test("closing a following card stops following its row", () => {
    const a = owner()
    const row = el("row-a")
    const card = el("card-a")
    const open = replay([{ type: "preview.opened", owner: a }, attach(a, row, card)])
    expect(open.effects).toEqual([{ type: "follow.start", trigger: row, card }])
    expect(selectTabPreviewFollowCard(open.state, row)).toBe(card)

    const closed = transitionTabPreview(open.state, { type: "preview.closed", owner: a })
    expect(closed.effects).toEqual([{ type: "follow.stop" }, { type: "warm.start", attempt: 1, delayMs: 500 }])
    // Pointer moves over the closed row no longer place a card.
    expect(selectTabPreviewFollowCard(closed.state, row)).toBeUndefined()
  })

  test("a neighbouring tab takes over at once and closes the previous preview", () => {
    const a = owner()
    const b = owner()
    const rowA = el("row-a")
    const open = replay([{ type: "preview.opened", owner: a }, attach(a, rowA, el("card-a"))]).state
    expect(selectTabPreviewInstant(open)).toBe(false)
    expect(selectTabPreviewOpenDelay(open)).toBe(0)

    const handoff = transitionTabPreview(open, { type: "preview.opened", owner: b })
    expect(handoff.effects).toEqual([{ type: "follow.stop" }, { type: "owner.close", owner: a }])
    expect(selectTabPreviewInstant(handoff.state)).toBe(true)
    expect(selectTabPreviewFollowCard(handoff.state, rowA)).toBeUndefined()

    // The closed tab reports back; it no longer owns the preview.
    const stale = transitionTabPreview(handoff.state, { type: "preview.closed", owner: a })
    expect(stale.state).toBe(handoff.state)
    expect(stale.effects).toEqual([])
    // A follow from the previous card's late mount is ignored too.
    expect(transitionTabPreview(handoff.state, attach(a, rowA, el("card-a"))).state).toBe(handoff.state)
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

  test("reduced motion keeps the card in place", () => {
    const a = owner()
    const row = el("row-a")
    const open = replay([{ type: "preview.opened", owner: a }, attach(a, row, el("card-a"), true)])
    expect(open.effects).toEqual([])
    expect(selectTabPreviewFollowCard(open.state, row)).toBeUndefined()
  })

  test("the same card attaching again does not restart following", () => {
    const a = owner()
    const row = el("row-a")
    const card = el("card-a")
    const open = replay([{ type: "preview.opened", owner: a }, attach(a, row, card)]).state
    expect(transitionTabPreview(open, attach(a, row, card)).state).toBe(open)

    const remounted = transitionTabPreview(open, attach(a, row, el("card-a2")))
    expect(remounted.effects).toEqual([
      { type: "follow.stop" },
      { type: "follow.start", trigger: row, card: { id: "card-a2" } },
    ])
  })

  test("closes and disposals of a tab that is not showing change nothing", () => {
    const a = owner()
    const cold = INITIAL_TAB_PREVIEW_STATE
    expect(transitionTabPreview(cold, { type: "preview.closed", owner: a }).state).toBe(cold)
    expect(transitionTabPreview(cold, { type: "owner.disposed", owner: a }).state).toBe(cold)
    expect(transitionTabPreview(cold, { type: "warm.expired", attempt: 0 }).state).toBe(cold)
  })
})
