import { afterEach, beforeEach, expect, test } from "bun:test"
import { createTimelineMotion } from "./timeline-motion"

type Played = {
  element: Element
  frames: Keyframe[]
  easing?: string
  duration?: KeyframeAnimationOptions["duration"]
  animation: {
    startTime: number | null
    currentTime: number
    cancelled: boolean
    cancel: () => void
    finished: Promise<unknown>
  }
}

// happy-dom has no Web Animations; record what would have been handed to the compositor.
let played: Played[] = []

const native = Object.getOwnPropertyDescriptor(Element.prototype, "animate")

const timeline = Object.getOwnPropertyDescriptor(document, "timeline")

beforeEach(() => {
  played = []
  Object.defineProperty(document, "timeline", { configurable: true, value: { currentTime: 1000 } })
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, frames: Keyframe[], options?: KeyframeAnimationOptions) {
      const animation: Played["animation"] = {
        startTime: null,
        currentTime: 0,
        cancelled: false,
        cancel: () => (animation.cancelled = true),
        finished: new Promise(() => {}),
      }

      played.push({ element: this, frames, easing: options?.easing, duration: options?.duration, animation })

      return animation
    },
  })
})

afterEach(() => {
  if (timeline) Object.defineProperty(document, "timeline", timeline)
  else {
    // SAFETY: the configurable own property was installed by beforeEach above.
    delete (document as { timeline?: DocumentTimeline }).timeline
  }

  if (native) Object.defineProperty(Element.prototype, "animate", native)
  else {
    // SAFETY: as above.
    delete (Element.prototype as Partial<Element>).animate
  }
})

const spring = { duration: 0.4, bounce: 0 }

function setup() {
  const layer = document.createElement("div")
  document.body.replaceChildren(layer)
  const reach: number[] = []
  const edges: [string, number][] = []

  const motion = createTimelineMotion({
    layer: () => layer,
    spring: () => spring,
    timeScale: () => 1,
    onReach: (px) => reach.push(px),
    onEdge: (key, px) => edges.push([key, px]),
  })

  const row = () => {
    const wrapper = document.createElement("div")
    const inner = document.createElement("div")
    wrapper.append(inner)
    layer.append(wrapper)

    return { wrapper, inner }
  }

  return { layer, motion, reach, edges, row }
}

const translateY = (frame: Keyframe) => Number(String(frame.transform).match(/translateY\(([-\d.e]+)px\)/)![1])

// A move is two keyframes with its spring baked into a linear() easing; read it back as drawn offsets.
const offsets = (item: Played) => {
  const curve = item.easing?.match(/^linear\((.*)\)$/)?.[1]

  if (!curve) return item.frames.map(translateY)
  const from = translateY(item.frames[0]!)

  return curve.split(",").map((point) => from * (1 - Number(point)) || 0)
}

// A move's drawn offset `ms` into it.
const drawnAt = (item: Played, ms: number) => {
  const moves = offsets(item)
  const step = Number(item.duration) / (moves.length - 1)
  const index = Math.min(moves.length - 2, Math.floor(ms / step))

  return moves[index]! + (moves[index + 1]! - moves[index]!) * (ms / step - index)
}

const frame = 1000 / 60

const live = () => played.filter((item) => !item.animation.cancelled)

const on = (element: Element, property = "transform") =>
  live().find((item) => item.element === element && property in item.frames[0]!)

test("draws a jump back out on the row layer and springs it to rest without passing it", () => {
  const { layer, motion, reach } = setup()
  motion.kick(40, [])
  const moves = offsets(on(layer)!)
  expect(moves[0]).toBe(40)
  expect(moves.at(-1)).toBe(0)
  expect(moves.every((y, index) => index === 0 || (y <= moves[index - 1]! && y >= 0))).toBe(true)
  expect(reach.at(-1)).toBe(40)
  expect(live()).toHaveLength(1)
})

test("stretches moves and disclosures by slow motion once", () => {
  const normal = setup()
  normal.motion.kick(40, [])
  const base = Number(on(normal.layer)!.duration)
  const layer = document.createElement("div")
  document.body.replaceChildren(layer)

  // The growth spring arrives already stretched, as motion tuning hands it over.
  const motion = createTimelineMotion({
    layer: () => layer,
    spring: () => ({ duration: spring.duration * 4, bounce: 0 }),
    timeScale: () => 4,
    onReach: () => {},
    onEdge: () => {},
  })

  motion.kick(40, [])
  expect(Number(on(layer)!.duration) / base).toBeCloseTo(4, 1)
  motion.cancel()
  motion.kick(40, [], 0.18)
  expect(on(layer)!.duration).toBe(720)
})

test("bends a running move toward a second jump instead of restarting it", () => {
  const { layer, motion } = setup()
  motion.kick(40, [])
  const first = on(layer)!
  first.animation.currentTime = 100
  motion.kick(40, [])
  expect(first.animation.cancelled).toBe(true)
  const second = on(layer)!
  expect(drawnAt(second, 0)).toBeCloseTo(drawnAt(first, 100) + 40, 1)
  // The second jump adds offset but no push: a frame on, the rows are where the first move alone would have them.
  expect(Math.abs(drawnAt(second, frame) - drawnAt(first, 100 + frame) - 40)).toBeLessThan(0.4)
})

test("starts a jump from rest without a push", () => {
  const { layer, motion } = setup()
  motion.kick(40, [])
  expect(drawnAt(on(layer)!, frame)).toBeGreaterThan(39.6)
})

test("disclosure starts promptly and retains its deadline when content changes mid-open", () => {
  const { layer, motion } = setup()
  motion.kick(40, [], 0.18)
  const first = on(layer)!
  expect(first.duration).toBe(180)
  const moves = offsets(first)
  expect(moves[1]).toBeLessThan(32)
  first.animation.currentTime = 90
  const drawn = motion.offset("a").x
  motion.kick(20, [])
  expect(on(layer)!.duration).toBeCloseTo(90)
  expect(offsets(on(layer)!)[0]).toBeCloseTo(drawn + 20, 2)
  expect(offsets(on(layer)!).at(-1)).toBe(0)
})

test("reveals a grown row's new part under its box with the soft edge riding the box's lower edge", () => {
  const { motion, edges, row } = setup()
  const { wrapper, inner } = row()
  motion.kick(0, [{ key: "a", wrapper, inner, box: -30, content: 0, edge: 28 }])
  // A main-thread clip must not start a frame before its compositor transforms are ready.
  expect(live().map((item) => item.animation.startTime)).toEqual([1000, 1000, 1000])
  const box = offsets(on(wrapper)!)
  const content = offsets(on(inner)!)
  expect([box[0], content[0]]).toEqual([-30, 30])
  // The content itself never moves; only how much of it shows.
  expect(box.every((y, index) => Math.abs(y + content[index]!) < 0.01)).toBe(true)
  expect([box.at(-1), content.at(-1)]).toEqual([0, 0])

  // The box reaches 28px past its slot meanwhile; a clip trims what the narrowing edge no longer covers, so the row is
  // never drawn past the reveal onto the row below.
  const tails = on(wrapper, "clipPath")!.frames.map((frame) =>
    Number(String(frame.clipPath).split(" ")[2]!.replace("px", "")),
  )

  expect([tails[0], tails.at(-1)]).toEqual([28, 28])
  expect(box.every((y, index) => y + 28 - tails[index]! <= 0.01)).toBe(true)
  expect(edges).toEqual([["a", 28]])
  motion.cancel()
  expect(edges).toEqual([
    ["a", 28],
    ["a", 0],
  ])
})

test.each([100, 300])("keeps the soft edge continuous when more text arrives after %ims", (elapsed) => {
  const { motion, edges, row } = setup()
  const { wrapper, inner } = row()
  motion.kick(0, [{ key: "a", wrapper, inner, box: -60, content: 0, edge: 12 }])
  played[0]!.animation.currentTime = elapsed
  motion.kick(0, [])
  const drawn = offsets(on(wrapper)!)[0]!
  // The text completes mid-reveal and grows another 24px; a completed row would otherwise take the 28px edge.
  motion.kick(0, [{ key: "a", wrapper, inner, box: -24, content: 0, edge: 28 }])
  expect(offsets(on(wrapper)!)[0]).toBeCloseTo(drawn - 24, 2)
  expect(edges).toEqual([["a", 12]])
})

test("fades an arriving row in as it is revealed", () => {
  const { motion, row } = setup()
  const { wrapper, inner } = row()
  motion.kick(0, [{ key: "a", wrapper, inner, box: -40, content: 0, enter: 40 }])
  const fades = on(wrapper)!.frames.map((frame) => Number(frame.opacity))
  expect(fades[0]).toBe(0)
  expect(fades.at(-1)).toBe(1)
  expect(fades.every((value, index) => index === 0 || value >= fades[index - 1]!)).toBe(true)
})

test("holds a landing row in its slot while the rows around it move", () => {
  const { layer, motion, row } = setup()
  const { wrapper, inner } = row()
  motion.kick(50, [{ key: "a", wrapper, inner, box: 0, content: 0, hold: true }])
  const moves = offsets(on(layer)!)
  const held = offsets(on(wrapper)!)
  expect(moves.every((y, index) => Math.abs(y + held[index]!) < 0.01)).toBe(true)
  expect(on(inner)).toBeUndefined()
})

test("carries a follower with its row through later jumps", () => {
  const { motion } = setup()
  motion.kick(40, [])
  const carrier = document.createElement("div")
  const followed = motion.follow("a", carrier)
  expect(followed.offset).toBe(40)
  expect(offsets(on(carrier)!)[0]).toBe(40)
  motion.kick(20, [])
  expect(carrier.style.translate).toBe("0 -20px")
  expect(offsets(on(carrier)!)[0]).toBe(60)
  followed.stop()
  expect(carrier.style.translate).toBe("")
})

test("moves a follower with its row when the followed end rides the composer's edge", () => {
  const { motion } = setup()
  motion.kick(40, [])
  const carrier = document.createElement("div")
  const followed = motion.follow("a", carrier)
  // The queue closing under a landing steer lowers every row with no content change to draw.
  motion.scroll(30)
  motion.scroll(14)
  expect(carrier.style.translate).toBe("0 44px")
  // A later jump keeps what the rows rode, and the spring still draws only the jump.
  motion.kick(20, [])
  expect(carrier.style.translate).toBe("0 24px")
  followed.stop()
  expect(carrier.style.translate).toBe("")
})

test("lands everything at once", () => {
  const { motion, reach, row } = setup()
  const { wrapper, inner } = row()
  motion.kick(40, [{ key: "a", wrapper, inner, box: -10, content: 0 }])
  expect(motion.moving()).toBe(true)
  motion.cancel()
  expect(live()).toHaveLength(0)
  expect(reach.at(-1)).toBe(0)
  expect(motion.moving()).toBe(false)
})
