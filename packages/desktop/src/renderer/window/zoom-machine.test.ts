import { describe, expect, test } from "bun:test"
import { nextDesktopZoomLevel } from "@opencode/app/desktop-menu"
import {
  createZoomState,
  selectRequestedZoom,
  selectWebviewZoom,
  transitionZoom,
  type ZoomEvent,
  type ZoomState,
} from "./zoom-machine"

const reply = { resolve: () => {}, reject: () => {} }

function replay(events: readonly ZoomEvent[], from = createZoomState()) {
  return events.reduce((state, event) => transitionZoom(state, event).state, from)
}

const pinchOn = replay([{ type: "pinch.seeded", enabled: true }])

describe("zoom requests", () => {
  test("rolls a refused level back so the next step starts from the real zoom", () => {
    const refused = replay([
      { type: "factor.seeded", factor: 1 },
      { type: "level.requested", level: 1.1, reply },
      { type: "level.failed", attempt: 1 },
    ])

    // On dev the refused 1.1 stuck as the requested zoom and the next Zoom In jumped to 1.25.
    expect(selectRequestedZoom(refused)).toBe(1)
    expect(nextDesktopZoomLevel(selectRequestedZoom(refused), "in")).toBe(1.1)
  })

  test("keeps a reset to 1 when the boot read of the reloaded window's zoom lands later", () => {
    const state = replay([
      { type: "level.requested", level: 1, reply },
      { type: "factor.seeded", factor: 1.5 },
      { type: "level.seeded", level: 1.5 },
    ])

    expect(selectWebviewZoom(state)).toBe(1)
    expect(selectRequestedZoom(state)).toBe(1)
    expect(state.level).toBe(1)
  })

  test("keeps the newest step pending while main reports an earlier one", () => {
    const stepped = replay([
      { type: "level.requested", level: 1.1, reply },
      { type: "level.requested", level: 1.25, reply },
      { type: "zoom.changed", factor: 1.1000000001, level: 1.1 },
    ])

    expect(selectRequestedZoom(stepped)).toBe(1.25)
    expect(replay([{ type: "level.succeeded", attempt: 1 }], stepped)).toBe(stepped)
    expect(selectRequestedZoom(replay([{ type: "level.failed", attempt: 2 }], stepped))).toBe(1.1000000001)
    expect(selectWebviewZoom(replay([{ type: "zoom.changed", factor: 1.25, level: 1.25 }], stepped))).toBe(1.25)
  })

  test("restores the pinch setting and wheel listener when main refuses it", () => {
    const requested = transitionZoom(pinchOn, { type: "pinch.requested", enabled: false, reply })

    expect(requested.effects).toEqual([
      { type: "sync-wheel-listener", enabled: false },
      { type: "set-pinch-zoom", attempt: 1, enabled: false, reply },
    ])
    expect(transitionZoom(requested.state, { type: "pinch.failed", attempt: 1 }).effects).toEqual([
      { type: "sync-wheel-listener", enabled: true },
    ])
  })
})

describe("wheel pinch", () => {
  const wheel = (delta: number): ZoomEvent => ({ type: "wheel.pinched", delta })

  test("waits for the threshold, then zooms from the zoom at that point", () => {
    const small = transitionZoom(pinchOn, wheel(10))

    expect(small.state.status).toBe("accumulating")
    expect(small.effects).toEqual([{ type: "arm-pinch-timer" }])

    const started = replay([wheel(10)], small.state)

    expect(started).toMatchObject({ status: "pinching", startZoom: 1, totalDelta: 0 })

    const zoomed = transitionZoom(started, wheel(-20))

    expect(zoomed.effects).toEqual([{ type: "arm-pinch-timer" }, { type: "set-zoom-factor", attempt: 1, factor: 1.2 }])
    expect(replay([{ type: "pinch.ended" }], zoomed.state).status).toBe("idle")
  })

  test("ends the gesture when a keyboard step or another window changes the zoom", () => {
    const pinching = replay([wheel(-20), wheel(-20)], pinchOn)

    // On dev the next wheel frame zoomed from the gesture's stale start zoom and undid the reset.
    const reset = transitionZoom(pinching, { type: "level.requested", level: 1, reply })

    expect(reset.state.status).toBe("idle")
    expect(reset.effects[0]).toEqual({ type: "cancel-pinch-timer" })
    expect(transitionZoom(pinching, { type: "zoom.changed", factor: 2, level: 2 }).state.status).toBe("idle")

    const next = replay([wheel(-20), wheel(-20)], replay([{ type: "level.succeeded", attempt: 2 }], reset.state))

    expect(next).toMatchObject({ status: "pinching", startZoom: 1 })
  })

  test("returns the same state for a zero delta or while pinch zoom is off", () => {
    const pinching = replay([wheel(-20)], pinchOn)
    const off: ZoomState = createZoomState()

    expect(transitionZoom(pinching, wheel(0)).state).toBe(pinching)
    expect(transitionZoom(off, wheel(-40)).state).toBe(off)
  })
})
