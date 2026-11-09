import { describe, expect, test } from "bun:test"
import {
  createGrowState,
  createMorphState,
  didGrowClose,
  DISPOSED_GROW_EVENT,
  DISPOSED_MORPH_EVENT,
  isGrowMoving,
  isMorphFaceLeaving,
  morphFaces,
  REDUCED_GROW_EVENT,
  SETTLE_MORPH_EVENT,
  transitionGrow,
  transitionMorph,
  type GrowEvent,
  type GrowState,
  type MorphEvent,
  type MorphState,
} from "./spring-height-machine"

type Face = { key: string; label?: string }

const curve = { duration: 0.4, bounce: 0 }

const composer: Face = { key: "composer" }

const docks: Face = { key: "docks" }

const changed = (
  face: Face,
  options: { instant?: boolean; reduced?: boolean; from?: number } = {},
): MorphEvent<Face> => ({
  type: "face.changed",
  face,
  instant: options.instant ?? false,
  reduced: options.reduced ?? false,
  dpr: 1,
  from: options.from ?? 0,
  curves: { morph: curve, fadeIn: curve },
})

const flying = (state: MorphState<Face>) => {
  if (state.status !== "flying") throw new Error(`expected a flight, got ${state.status}`)

  return state
}

const morphFrame = (state: MorphState<Face>, reduced = false): MorphEvent<Face> => ({
  type: "frame",
  attempt: state.status === "flying" ? state.attempt : -1,
  dt: 1 / 60,
  reduced,
  dpr: 1,
})

// Steps a flight frame by frame until it rests, keeping each frame's region height and boxes.
function fly(state: MorphState<Face>, reduced = false) {
  const frames: { shown: number; boxes: number[]; offsets: number[]; entering: number }[] = []
  let current = state

  for (let i = 0; i < 600 && current.status === "flying"; i++) {
    const next = transitionMorph(current, morphFrame(current, reduced))

    if (next.status !== "flying") return { state: next, frames }
    expect(next).toBe(current)
    frames.push({
      shown: next.shown,
      boxes: next.faces.map((face) => face.box),
      offsets: next.faces.map((face) => face.offset),
      entering: next.entering.presence.value,
    })
    current = next
  }

  return { state: current, frames }
}

// The composer at rest, measured at 100px, the way the driver measures it before a flight.
const restingComposer = () => transitionMorph(createMorphState(composer), { type: "face.measured", id: 1, height: 100 })

describe("transitionMorph", () => {
  test("animates down to a face measured at 0px instead of snapping at the end", () => {
    const start = flying(transitionMorph(restingComposer(), changed(docks, { from: 100 })))
    const measured = transitionMorph(start, { type: "face.measured", id: start.entering.id, height: 0 })
    expect(measured).toBe(start)

    const result = fly(measured)
    expect(start.height.target).toBe(0)
    expect(result.frames.filter((frame) => frame.shown > 0 && frame.shown < 100).length).toBeGreaterThan(5)
    result.frames.forEach((frame, index) => {
      if (index > 0) expect(frame.shown).toBeLessThanOrEqual(result.frames[index - 1]!.shown)
    })
    expect(result.state).toMatchObject({ status: "resting", face: { value: docks, height: 0 } })
  })

  test("lands at once when settled mid-flight and keeps only the entering face", () => {
    const start = flying(transitionMorph(restingComposer(), changed(docks, { from: 100 })))
    const mid = transitionMorph(start, morphFrame(start))
    const settled = transitionMorph(mid, SETTLE_MORPH_EVENT)

    expect(settled).toMatchObject({ status: "resting", face: { id: start.entering.id, value: docks } })
    expect(morphFaces(settled)).toHaveLength(1)
  })

  test("swaps to a fresh face at rest for an instant change mid-flight", () => {
    const start = flying(transitionMorph(restingComposer(), changed(docks, { from: 100 })))
    const next = transitionMorph(start, changed({ key: "composer", label: "instant" }, { instant: true }))

    expect(next).toMatchObject({ status: "resting", face: { value: { label: "instant" } } })
    expect(morphFaces(next)[0]!.id).not.toBe(1)
  })

  test("starts a fresh flight after one settles and ignores the old flight's frames", () => {
    const first = flying(transitionMorph(restingComposer(), changed(docks, { from: 100 })))
    const stale = morphFrame(first)
    const rested = transitionMorph(first, SETTLE_MORPH_EVENT)
    const second = flying(transitionMorph(rested, changed(composer, { from: 80 })))

    expect(second.attempt).toBe(first.attempt + 1)
    expect(transitionMorph(second, stale)).toBe(second)
    expect(fly(second).state).toMatchObject({ status: "resting", face: { value: composer } })
  })

  test("stacks docks above the composer and keeps the boxes inside the region on every frame", () => {
    for (const [from, to] of [
      [composer, docks],
      [docks, composer],
    ] as const) {
      const rest = transitionMorph(createMorphState(from), { type: "face.measured", id: 1, height: 120 })
      const start = flying(transitionMorph(rest, changed(to, { from: 120 })))
      const measured = transitionMorph(start, { type: "face.measured", id: start.entering.id, height: 60 })

      expect(flying(measured).faces.map((face) => face.value.key)).toEqual(["docks", "composer"])
      const result = fly(measured)
      result.frames.forEach((frame) => {
        expect(frame.offsets[0]).toBe(0)
        expect(frame.offsets[1]).toBe(frame.boxes[0]!)
        expect(frame.boxes[0]! + frame.boxes[1]!).toBeLessThanOrEqual(frame.shown + 1)
      })
      expect(result.state).toMatchObject({ status: "resting", face: { value: to, height: 60 } })
    }
  })

  test("brings the closing composer back when the change reverses mid-flight", () => {
    const start = flying(transitionMorph(restingComposer(), changed(docks, { from: 100 })))
    const back = flying(transitionMorph(transitionMorph(start, morphFrame(start)), changed(composer)))

    expect(back.entering.id).toBe(1)
    expect(back.faces.map((face) => face.id)).toEqual([start.entering.id, 1])
    expect(isMorphFaceLeaving(back, start.entering.id)).toBe(true)
    expect(isMorphFaceLeaving(back, 1)).toBe(false)
  })

  test("drops a face that has all but closed when the flight turns again", () => {
    const start = flying(transitionMorph(restingComposer(), changed(docks, { from: 100 })))

    for (let i = 0; i < 6; i++) transitionMorph(start, morphFrame(start))
    start.faces.find((face) => face.value.key === "composer")!.presence.snap(0.005)
    const next = flying(transitionMorph(start, changed({ key: "other" })))

    expect(next.faces.map((face) => face.value.key)).toEqual(["docks", "other"])
  })

  test("holds the closing face under reduced motion until it has faded, then fades the new face in", () => {
    const start = flying(transitionMorph(restingComposer(), changed(docks, { from: 100, reduced: true })))
    const measured = transitionMorph(start, { type: "face.measured", id: start.entering.id, height: 40 })
    const result = fly(measured, true)
    const waiting = result.frames.filter((frame) => frame.boxes[1] === 100)

    expect(waiting.length).toBeGreaterThan(0)
    waiting.forEach((frame) => {
      expect(frame.shown).toBe(100)
      expect(frame.entering).toBe(0)
    })
    expect(result.frames.at(-1)!.shown).toBe(40)
    expect(result.state).toMatchObject({ status: "resting", face: { value: docks } })
  })

  test("updates the face's value in place without restarting the flight", () => {
    const start = flying(transitionMorph(restingComposer(), changed(docks, { from: 100 })))
    const updated = flying(transitionMorph(start, changed({ key: "docks", label: "permission" })))

    expect(updated).toMatchObject({ attempt: start.attempt, entering: { id: start.entering.id } })
    expect(updated.entering.value.label).toBe("permission")
    expect(updated.height).toBe(start.height)
    expect(transitionMorph(updated, changed(updated.entering.value))).toBe(updated)
  })

  test("swaps at rest for an instant change and ignores settle and frames at rest", () => {
    const rest = restingComposer()
    const next = transitionMorph(rest, changed(docks, { instant: true }))

    expect(next).toMatchObject({ status: "resting", face: { id: 2, value: docks } })
    expect(transitionMorph(next, SETTLE_MORPH_EVENT)).toBe(next)
    expect(transitionMorph(next, { type: "frame", attempt: 0, dt: 1 / 60, reduced: false, dpr: 1 })).toBe(next)
  })

  test("ignores every event once disposed", () => {
    const start = transitionMorph(restingComposer(), changed(docks, { from: 100 }))
    const disposed = transitionMorph(start, DISPOSED_MORPH_EVENT)

    expect(disposed.status).toBe("disposed")
    expect(transitionMorph(disposed, changed(composer))).toBe(disposed)
    expect(transitionMorph(disposed, SETTLE_MORPH_EVENT)).toBe(disposed)
  })
})

const curves = { open: curve, close: curve, fadeIn: curve }

const sync = (
  open: boolean,
  options: { instant?: boolean; appear?: boolean; reduced?: boolean; fade?: boolean } = {},
): GrowEvent => ({
  type: "sync",
  open,
  appear: options.appear ?? false,
  instant: options.instant ?? false,
  reduced: options.reduced ?? false,
  fade: options.fade ?? true,
  card: false,
  curves,
})

const moving = (state: GrowState) => {
  if (!isGrowMoving(state)) throw new Error(`expected a flight, got ${state.status}`)

  return state
}

const measured = (state: GrowState, full: number, rendered = 0): GrowEvent => ({
  type: "measured",
  attempt: moving(state).attempt,
  marginBelow: 8,
  marginAbove: 0,
  margin: 0,
  full,
  rendered,
})

const growFrame = (state: GrowState): GrowEvent => ({
  type: "frame",
  attempt: moving(state).attempt,
  dt: 1 / 60,
  dpr: 1,
})

function grow(state: GrowState) {
  const heights: number[] = []
  let current = state

  for (let i = 0; i < 600 && isGrowMoving(current); i++) {
    const next = transitionGrow(current, growFrame(current))

    if (!isGrowMoving(next)) return { state: next, heights }
    expect(next).toBe(current)
    heights.push(next.height)
    current = next
  }

  return { state: current, heights }
}

describe("transitionGrow", () => {
  test("lands open, without closing, when it opens and turns instant in one batch mid-close", () => {
    const closing = moving(transitionGrow(createGrowState(true), sync(false)))
    const next = transitionGrow(closing, sync(true, { instant: true }))

    expect(next).toEqual({ status: "present", attempt: closing.attempt })
    expect(didGrowClose(closing, next)).toBe(false)

    const opening = moving(transitionGrow(createGrowState(false), sync(true)))

    for (const flight of [opening, closing]) {
      const closed = transitionGrow(flight, sync(false, { instant: true }))
      expect(closed.status).toBe("absent")
      expect(didGrowClose(flight, closed)).toBe(true)
    }
  })

  test("finishes where it was going when its element is detached", () => {
    const opening = moving(transitionGrow(createGrowState(false), sync(true)))
    const opened = transitionGrow(opening, { type: "detached", attempt: opening.attempt })
    expect(opened.status).toBe("present")
    expect(didGrowClose(opening, opened)).toBe(false)

    const closing = moving(transitionGrow(opened, sync(false)))
    expect(transitionGrow(closing, { type: "detached", attempt: opening.attempt })).toBe(closing)
    const closed = transitionGrow(closing, { type: "detached", attempt: closing.attempt })
    expect(closed.status).toBe("absent")
    expect(didGrowClose(closing, closed)).toBe(true)
  })

  test("finishes where it was going when Reduce Motion turns on mid-flight", () => {
    const opening = transitionGrow(createGrowState(false), sync(true))
    expect(transitionGrow(opening, REDUCED_GROW_EVENT).status).toBe("present")

    const closing = transitionGrow(createGrowState(true), sync(false))
    const closed = transitionGrow(closing, REDUCED_GROW_EVENT)
    expect(closed.status).toBe("absent")
    expect(didGrowClose(closing, closed)).toBe(true)
    expect(transitionGrow(createGrowState(true), REDUCED_GROW_EVENT).status).toBe("present")
  })

  test("never reports a close when disposed mid-flight", () => {
    for (const flight of [
      transitionGrow(createGrowState(false), sync(true)),
      transitionGrow(createGrowState(true), sync(false)),
    ]) {
      const disposed = transitionGrow(flight, DISPOSED_GROW_EVENT)
      expect(disposed.status).toBe("disposed")
      expect(didGrowClose(flight, disposed)).toBe(false)
      expect(transitionGrow(disposed, sync(true))).toBe(disposed)
      expect(transitionGrow(disposed, REDUCED_GROW_EVENT)).toBe(disposed)
    }
  })

  test("grows in on mount only when asked to appear", () => {
    const present = createGrowState(true)
    expect(transitionGrow(present, sync(true))).toBe(present)
    expect(transitionGrow(present, sync(true, { appear: true, instant: true }))).toBe(present)
    expect(moving(transitionGrow(present, sync(true, { appear: true })))).toMatchObject({
      status: "opening",
      fromRendered: false,
    })
    const absent = createGrowState(false)
    expect(transitionGrow(absent, sync(false))).toBe(absent)
    expect(transitionGrow(absent, sync(true, { instant: true })).status).toBe("present")
  })

  test("opens to the content's height and lands present", () => {
    const opening = transitionGrow(createGrowState(false), sync(true))
    const result = grow(transitionGrow(opening, measured(opening, 120)))

    expect(result.heights.length).toBeGreaterThan(5)
    result.heights.forEach((height, index) => {
      expect(height).toBeLessThanOrEqual(120)

      if (index > 0) expect(height).toBeGreaterThanOrEqual(result.heights[index - 1]!)
    })
    expect(result.state.status).toBe("present")
  })

  test("closes from the rendered height and lands absent", () => {
    const closing = transitionGrow(createGrowState(true), sync(false))
    const start = transitionGrow(closing, measured(closing, 120, 120))
    expect(moving(start).spring.value).toBe(120)
    expect(transitionGrow(start, measured(start, 10, 10))).toBe(start)

    const result = grow(start)
    expect(result.heights[0]).toBeLessThan(120)
    expect(result.heights[0]).toBeGreaterThan(60)
    expect(result.state.status).toBe("absent")
    expect(didGrowClose(start, result.state)).toBe(true)
  })

  test("turning back before the first frame keeps the flight and its start from the rendered height", () => {
    const closing = moving(transitionGrow(createGrowState(true), sync(false)))
    const opening = moving(transitionGrow(closing, sync(true)))

    expect(opening).toMatchObject({ status: "opening", attempt: closing.attempt, fromRendered: true })
    expect(opening.spring).toBe(closing.spring)
    expect(transitionGrow(opening, sync(true))).toBe(opening)
    expect(moving(transitionGrow(opening, measured(opening, 120, 90))).spring.value).toBe(90)
  })

  test("tracks the content's size mid-flight and ignores a stale flight's measures, resizes and frames", () => {
    const first = moving(transitionGrow(createGrowState(false), sync(true)))
    const closed = transitionGrow(first, sync(false, { instant: true }))
    const second = moving(transitionGrow(closed, sync(true)))

    expect(second.attempt).toBe(first.attempt + 1)
    expect(transitionGrow(second, { type: "resized", attempt: first.attempt, size: 50 })).toBe(second)
    expect(transitionGrow(second, measured(first, 50))).toBe(second)
    expect(transitionGrow(second, growFrame(first))).toBe(second)

    const sized = transitionGrow(second, { type: "resized", attempt: second.attempt, size: 70 })
    expect(sized).toBe(second)
    expect(second.full).toBe(70)
  })
})
