import { expect, test } from "bun:test"
import {
  canGrabVoicePanel,
  canToggleVoiceCaptions,
  fillVoicePanelBounds,
  HYDRATING_VOICE_PANEL_STATE,
  transitionVoicePanel,
  voicePanelTransform,
  type PanelBounds,
  type VoicePanelEvent,
} from "./panel-machine"

// The panel's home is the bottom-right of a 1280x800 window.
const home = { left: 900, right: 1200, top: 600, bottom: 780 }
const bounds = (rect = home, x = 0, y = 0) =>
  fillVoicePanelBounds({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, rect, { x, y }, 1280, 800)

const run = (...events: VoicePanelEvent[]) => events.reduce(transitionVoicePanel, HYDRATING_VOICE_PANEL_STATE)
const down = (pointerId: number, clientX: number, clientY: number, at: PanelBounds = bounds()): VoicePanelEvent => ({
  type: "pointer.down",
  pointerId,
  clientX,
  clientY,
  bounds: at,
})
const hydrated = (x = 0, y = 0): VoicePanelEvent => ({ type: "hydrated", x, y, bounds: bounds() })

test("nothing moves the panel or its captions before the saved position loads", () => {
  expect(run(down(1, 1000, 700), { type: "resize", bounds: bounds() })).toBe(HYDRATING_VOICE_PANEL_STATE)
  expect(canGrabVoicePanel(HYDRATING_VOICE_PANEL_STATE)).toBe(false)
  expect(canToggleVoiceCaptions(HYDRATING_VOICE_PANEL_STATE)).toBe(false)

  const loaded = run(hydrated(-420, -260))
  expect(loaded).toEqual({ status: "idle", x: -420, y: -260 })
  expect(canToggleVoiceCaptions(loaded)).toBe(true)
})

test("a saved position from a larger window is measured from the painted home, not the saved offset", () => {
  // Painted at home while hydrating: 500px right would put the panel at 1400..1700, off screen.
  expect(run(hydrated(500, 0))).toEqual({ status: "idle", x: 80, y: 0 })
  expect(run(hydrated(-200, -100))).toEqual({ status: "idle", x: -200, y: -100 })
  // Bounds measured after a drag account for the offset already painted.
  expect(bounds({ left: 700, right: 1000, top: 600, bottom: 780 }, -200, 0)).toEqual(bounds())
})

test("a second pointer neither steals the drag nor moves it", () => {
  const dragging = run(hydrated(), down(1, 1000, 700))
  expect(transitionVoicePanel(dragging, down(2, 400, 300))).toBe(dragging)
  expect(transitionVoicePanel(dragging, { type: "pointer.move", pointerId: 2, clientX: 0, clientY: 0 })).toBe(dragging)
  expect(transitionVoicePanel(dragging, { type: "pointer.up", pointerId: 2 })).toBe(dragging)
  expect(voicePanelTransform(dragging)).toBe("translate(0px, 0px)")

  const moved = transitionVoicePanel(dragging, { type: "pointer.move", pointerId: 1, clientX: 900, clientY: 650 })
  expect(moved).toBe(dragging)
  expect(voicePanelTransform(moved)).toBe("translate(-100px, -50px)")
  expect(transitionVoicePanel(moved, { type: "pointer.up", pointerId: 1 })).toEqual({ status: "idle", x: -100, y: -50 })
})

test("a panel that grows mid-drag keeps later moves on screen", () => {
  const dragging = run(hydrated(), down(1, 1000, 700))
  transitionVoicePanel(dragging, { type: "pointer.move", pointerId: 1, clientX: 1000, clientY: 1000 })
  expect(voicePanelTransform(dragging)).toBe("translate(0px, 20px)")

  // A caption grows the panel 100px downwards past the window's bottom edge.
  const taller = transitionVoicePanel(dragging, {
    type: "resize",
    bounds: bounds({ left: 900, right: 1200, top: 620, bottom: 900 }, 0, 20),
  })
  expect(taller).toBe(dragging)
  expect(voicePanelTransform(taller)).toBe("translate(0px, -80px)")
  transitionVoicePanel(taller, { type: "pointer.move", pointerId: 1, clientX: 1000, clientY: 1000 })
  expect(voicePanelTransform(taller)).toBe("translate(0px, -80px)")
  transitionVoicePanel(taller, { type: "pointer.move", pointerId: 1, clientX: 1000, clientY: 400 })
  expect(voicePanelTransform(taller)).toBe("translate(0px, -300px)")
})

test("every exit ends the drag where it was, and a disposed panel ignores everything", () => {
  const exits: VoicePanelEvent[] = [{ type: "pointer.up", pointerId: 1 }, { type: "blur" }]
  exits.forEach((exit) => {
    const dragging = run(hydrated(), down(1, 1000, 700))
    transitionVoicePanel(dragging, { type: "pointer.move", pointerId: 1, clientX: 950, clientY: 700 })
    expect(transitionVoicePanel(dragging, exit)).toEqual({ status: "idle", x: -50, y: 0 })
  })

  const disposed = run(hydrated(), down(1, 1000, 700), { type: "disposed" })
  expect(disposed).toEqual({ status: "disposed" })
  expect(run(hydrated(), { type: "disposed" }, hydrated(-10, -10), down(1, 0, 0))).toBe(disposed)
})

test("an idle panel keeps its state when nothing moves it", () => {
  const idle = run(hydrated(-100, -100))
  expect(transitionVoicePanel(idle, { type: "resize", bounds: bounds() })).toBe(idle)
  expect(transitionVoicePanel(idle, { type: "pointer.move", pointerId: 1, clientX: 0, clientY: 0 })).toBe(idle)
  expect(transitionVoicePanel(idle, { type: "pointer.up", pointerId: 1 })).toBe(idle)
  expect(transitionVoicePanel(idle, hydrated())).toBe(idle)
  // The window shrank: the panel is pulled back inside it.
  expect(transitionVoicePanel(idle, { type: "resize", bounds: { minX: -50, maxX: 0, minY: -50, maxY: 0 } })).toEqual({
    status: "idle",
    x: -50,
    y: -50,
  })
})
