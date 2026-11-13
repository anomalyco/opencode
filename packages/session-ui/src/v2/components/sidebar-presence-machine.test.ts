import { describe, expect, test } from "bun:test"
import {
  createSidebarPresenceState,
  selectSidebarMounted,
  transitionSidebarPresence,
  type SidebarPresenceEvent,
  type SidebarPresenceState,
} from "./sidebar-presence-machine"

const close = { type: "open.changed", open: false, animate: true } as const

const open = { type: "open.changed", open: true, animate: true } as const

function replay(events: SidebarPresenceEvent[], state = createSidebarPresenceState(true)) {
  return events.reduce<SidebarPresenceState>((current, event) => transitionSidebarPresence(current, event).state, state)
}

describe("transitionSidebarPresence", () => {
  test("a close stays mounted until its slide ends", () => {
    const closing = transitionSidebarPresence(createSidebarPresenceState(true), close)

    expect(closing.state).toEqual({ status: "closing", attempt: 1 })
    expect(closing.effects).toEqual([{ type: "exit.timer", attempt: 1 }])
    expect(selectSidebarMounted(closing.state)).toBe(true)
    expect(replay([{ type: "exit.ended" }], closing.state)).toEqual({ status: "closed", attempt: 1 })
  })

  test("a close lands when the slide never reports its end", () => {
    const closing = replay([close])

    expect(replay([{ type: "exit.timed-out", attempt: 1 }], closing).status).toBe("closed")
  })

  test("a reopen mid-close keeps the sidebar, and the old close's timer is stale", () => {
    const reopened = replay([close, open])

    expect(reopened.status).toBe("open")
    expect(transitionSidebarPresence(reopened, { type: "exit.timed-out", attempt: 1 }).state).toBe(reopened)
    expect(transitionSidebarPresence(reopened, { type: "exit.ended" }).state).toBe(reopened)

    const again = transitionSidebarPresence(reopened, close)
    expect(again.state).toEqual({ status: "closing", attempt: 2 })
    expect(replay([{ type: "exit.timed-out", attempt: 1 }], again.state).status).toBe("closing")
  })

  test("a toggle opens with a slide in; without motion it opens and closes at once", () => {
    expect(replay([open], createSidebarPresenceState(false)).status).toBe("opening")
    expect(replay([{ ...open, animate: false }], createSidebarPresenceState(false)).status).toBe("open")
    expect(replay([{ ...close, animate: false }]).status).toBe("closed")
  })

  test("a mount reflects the preference without a slide", () => {
    expect(createSidebarPresenceState(true).status).toBe("open")
    expect(selectSidebarMounted(createSidebarPresenceState(false))).toBe(false)
  })
})
