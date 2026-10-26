import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { motionGlobals, motionTuning } from "@opencode/ui/motion-tuning"
import { growthSpring } from "./row-growth"
import { landSendFlight, prepareSendFlight, sendFlightArc, sendFlightSpring } from "./send-flight"

type Played = {
  element: Element
  frames: Keyframe[]
  duration: number
  animation: { currentTime: number; cancel: () => void; finished: Promise<unknown> }
  finish: () => void
}

// happy-dom has no Web Animations; record what would have been handed to the compositor.
let played: Played[] = []

const native = Object.getOwnPropertyDescriptor(Element.prototype, "animate")

beforeEach(() => {
  played = []
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, frames: Keyframe[], options?: KeyframeAnimationOptions) {
      const finished = Promise.withResolvers<unknown>()

      const animation = {
        currentTime: 0,
        cancel: () => finished.reject(new Error("cancelled")),
        finished: finished.promise,
      }

      played.push({
        element: this,
        frames,
        duration: Number(options?.duration),
        animation,
        finish: () => finished.resolve(animation),
      })

      return animation
    },
  })
})

afterEach(() => {
  if (native) Object.defineProperty(Element.prototype, "animate", native)
  else {
    // SAFETY: the configurable own property was installed by beforeEach above.
    delete (Element.prototype as Partial<Element>).animate
  }
})

function setup() {
  const range = document.createRange()

  const mocks = [
    spyOn(range, "getBoundingClientRect").mockReturnValue(new DOMRect(380, 780, 60, 20)),
    spyOn(document, "createRange").mockReturnValue(range),
  ]

  const root = document.createElement("div")
  const scroll = document.createElement("div")
  scroll.dataset.slot = "session-timeline-scroll"
  const viewport = document.createElement("div")
  viewport.dataset.slot = "session-timeline-visible"
  const editor = document.createElement("div")
  editor.textContent = "send"
  root.append(scroll, viewport, editor)
  document.body.replaceChildren(root)

  const bubble = (top: number) => {
    const element = document.createElement("div")
    element.textContent = "send"
    scroll.append(element)
    mocks.push(spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(1000, top, 80, 36)))

    return element
  }

  return { root, editor, viewport, bubble, restore: () => mocks.forEach((mock) => mock.mockRestore()) }
}

const hosts = () => played.filter((item) => item.element instanceof HTMLElement && item.element.dataset.flight === "")

const top = (frame: Keyframe) => Number(String(frame.transform).match(/translate\([^,]+, ([-\d.]+)px\)/)![1])

const left = (frame: Keyframe) => Number(String(frame.transform).match(/translate\(([-\d.]+)px,/)![1])

function knob(id: string) {
  const found = motionTuning.list().find((item) => item.id === id)

  if (!found) throw new Error(`no knob ${id}`)

  return found
}

test("sends that share their first paint keep their distinct launch times", () => {
  const clock = spyOn(performance, "now").mockReturnValue(0)
  const { editor, bubble, restore } = setup()

  try {
    const bubbles = [0, 100, 150].map((at, index) => {
      clock.mockReturnValue(at)
      prepareSendFlight(`shared-${index}`, editor)

      return bubble(300 + index * 41)
    })

    // All three messages were submitted before the renderer could paint any of their flights.
    clock.mockReturnValue(180)
    bubbles.forEach((element, index) => expect(landSendFlight(`shared-${index}`, element)).toBe(true))
    expect(hosts().map((item) => item.animation.currentTime)).toEqual([180, 80, 30])
  } finally {
    restore()
    clock.mockRestore()
  }
})

test("aims at the bubble's resting slot while its row is still drawn away from it", async () => {
  const { editor, viewport, bubble, restore } = setup()

  try {
    prepareSendFlight("moving", editor)
    const element = bubble(300)
    const carrier: HTMLElement[] = []
    const stopped: boolean[] = []
    landSendFlight("moving", element, (value) => {
      carrier.push(value)

      return { offset: 30, stop: () => stopped.push(true) }
    })
    const host = hosts()[0]!
    // The carrier draws the row's remaining 30 px; the flight itself ends where the bubble rests.
    expect(top(host.frames.at(-1)!)).toBe(270)
    expect(carrier[0]?.contains(host.element)).toBe(true)
    expect(element.style.opacity).toBe("0")
    played.forEach((item) => item.finish())
    await Promise.resolve()
    await Promise.resolve()
    expect(element.style.opacity).toBe("")
    expect(stopped).toEqual([true])
    expect(viewport.querySelector("[data-send-flight]")).toBeNull()
  } finally {
    restore()
  }
})

test("lands in local CSS pixels when the box holding both ends is zoomed", async () => {
  const { root, editor, bubble, restore } = setup()
  root.style.zoom = "0.9"

  try {
    prepareSendFlight("zoomed", editor)
    const element = bubble(300)
    landSendFlight("zoomed", element, () => ({ offset: 30, stop: () => {} }))
    const host = hosts()[0]!
    expect(top(host.frames.at(-1)!)).toBeCloseTo(300 / 0.9 - 30)
    // SAFETY: flight hosts are the HTML elements the flight animates.
    expect(parseFloat((host.element as HTMLElement).style.width)).toBeCloseTo(80 / 0.9)
    played.forEach((item) => item.finish())
    await Promise.resolve()
    await Promise.resolve()
    expect(element.style.opacity).toBe("")
  } finally {
    restore()
  }
})

test("flies on its own spring, not the rows' growth spring", () => {
  const { editor, bubble, restore } = setup()
  const flight = knob("timeline.sendFlight")
  const growth = knob("timeline.growth")

  if (flight.kind !== "spring" || growth.kind !== "spring") throw new Error("not springs")

  const land = (id: string) => {
    played = []
    prepareSendFlight(id, editor)
    landSendFlight(id, bubble(300))

    return hosts()[0]!.duration
  }

  try {
    expect(sendFlightSpring().duration).toBeLessThan(growthSpring().duration)
    const shipped = land("shipped")
    motionTuning.set(growth, { duration: 0.9, bounce: 0 })
    expect(land("growth-tuned")).toBe(shipped)
    motionTuning.set(flight, { duration: 0.64, bounce: 0 })
    expect(land("flight-tuned")).toBeCloseTo(shipped * 2, -2)
  } finally {
    motionTuning.set(growth, { ...growth.initial })
    motionTuning.set(flight, { ...flight.initial })
    restore()
  }
})

test("draws over the composer it lifts off from, below the top of the timeline", () => {
  const { root, editor, viewport, bubble, restore } = setup()
  const visible = spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 40, 1200, 700))

  try {
    prepareSendFlight("over", editor)
    expect(editor.parentElement?.hasAttribute("data-send-flight-launch")).toBe(true)
    landSendFlight("over", bubble(300))
    const layer = root.querySelector<HTMLElement>("[data-send-flight]")!
    expect(layer.parentElement).toBe(root)
    expect(layer.style.clipPath).toStartWith("inset(40px ")
  } finally {
    visible.mockRestore()
    restore()
  }
})

test("arcs across before it rises, and flies straight at no arc", () => {
  const { editor, bubble, restore } = setup()
  const arc = knob("timeline.sendFlight.arc")

  if (arc.kind !== "number") throw new Error("not a number")

  // How far along its straight line each axis is, at the middle frame of the flight.
  const middle = (value: number) => {
    played = []
    motionTuning.set(arc, value)
    prepareSendFlight(`arc-${value}`, editor)
    landSendFlight(`arc-${value}`, bubble(300))
    const frames = hosts()[0]!.frames

    const along = (read: (frame: Keyframe) => number, frame: Keyframe) =>
      (read(frame) - read(frames[0]!)) / (read(frames.at(-1)!) - read(frames[0]!))

    const frame = frames[Math.round(frames.length / 8)]!

    return { x: along(left, frame), y: along(top, frame) }
  }

  try {
    expect(sendFlightArc()).toBe(0.6)
    const straight = middle(0)
    expect(straight.x).toBeCloseTo(straight.y, 5)
    const bent = middle(1)
    expect(bent.x).toBeGreaterThan(straight.x + 0.1)
    expect(bent.y).toBeLessThan(straight.y - 0.1)
  } finally {
    motionTuning.set(arc, arc.initial)
    restore()
  }
})

test("slow motion stretches the flight once", () => {
  const { editor, bubble, restore } = setup()

  const land = (id: string) => {
    played = []
    prepareSendFlight(id, editor)
    landSendFlight(id, bubble(300))

    return hosts()[0]!.duration
  }

  try {
    const normal = land("normal")
    motionTuning.set(motionGlobals.slow, true)
    expect(land("slow") / normal).toBeCloseTo(4, 1)
  } finally {
    motionTuning.set(motionGlobals.slow, false)
    restore()
  }
})

test("the placeholder waits until the last overlapping copy has landed", async () => {
  const { editor, bubble, restore } = setup()
  const launching = () => editor.parentElement!.hasAttribute("data-send-flight-launch")

  try {
    prepareSendFlight("first", editor)
    prepareSendFlight("second", editor)
    landSendFlight("first", bubble(300))
    played.forEach((item) => item.finish())
    await Promise.resolve()
    await Promise.resolve()
    expect(launching()).toBe(true)
    played = []
    landSendFlight("second", bubble(341))
    played.forEach((item) => item.finish())
    await Promise.resolve()
    await Promise.resolve()
    expect(launching()).toBe(false)
  } finally {
    restore()
  }
})

test("turning on reduced motion lands copies in the air and drops waiting ones", async () => {
  const { root, editor, bubble, restore } = setup()

  try {
    prepareSendFlight("flying", editor)
    const element = bubble(300)
    landSendFlight("flying", element)
    prepareSendFlight("waiting", editor)
    document.documentElement.dataset.motion = "reduce"
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
    expect(element.style.opacity).toBe("")
    expect(document.querySelector("[data-send-flight]")).toBeNull()
    expect(root.hasAttribute("data-send-flight-launch")).toBe(false)
  } finally {
    delete document.documentElement.dataset.motion
    restore()
  }
})
