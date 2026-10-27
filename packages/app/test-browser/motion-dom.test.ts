import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { enter, frameLoop, prefersReducedMotion, slideFrom } from "@opencode/ui/motion"
import { numberTween, slidingHighlight, springStyle, widthMorph } from "@opencode/ui/motion/solid"

let frames: Map<number, FrameRequestCallback>

let id: number

let reduced: boolean

let time: number

let preferenceQuery: ReducedMotionQuery

const cleanups: (() => void)[] = []

function frame(dt = 16.6667) {
  time += dt
  const next = [...frames.values()]
  frames.clear()

  for (const callback of next) callback(time)
}

function preference(value: boolean) {
  reduced = value

  preferenceQuery.dispatchEvent(new Event("change"))
}

function attach() {
  const el = document.createElement("div")
  document.body.append(el)

  return el
}

interface MockAnimation {
  animation: Animation
  finish: () => void
  reject: () => void
  frames: Keyframe[]
}

let animations: MockAnimation[]

class ReducedMotionQuery extends EventTarget implements MediaQueryList {
  readonly media = "(prefers-reduced-motion: reduce)"
  onchange = null
  get matches() {
    return reduced
  }
  addListener() {}
  removeListener() {}
}

// The frame loop and reduced-motion query read these browser globals lazily, so tests replace them per case.
const stubbed = ["requestAnimationFrame", "cancelAnimationFrame", "matchMedia"] as const

const originals = stubbed.map((name) => globalThis[name])

const originalAnimate = Element.prototype.animate

beforeEach(() => {
  frames = new Map()
  id = 0
  reduced = false
  time = 0
  preferenceQuery = new ReducedMotionQuery()
  animations = []
  spyOn(performance, "now").mockImplementation(() => time)
  globalThis.requestAnimationFrame = (fn: FrameRequestCallback) => {
    frames.set(++id, fn)

    return id
  }

  globalThis.cancelAnimationFrame = (key: number) => {
    frames.delete(key)
  }

  globalThis.matchMedia = () => preferenceQuery
  // happy-dom has no Web Animations API; the library feature-detects Element.animate.
  Element.prototype.animate = function (this: Element, keyframes) {
    let finish!: () => void
    let reject!: () => void

    const finished = new Promise<Animation>((resolve, fail) => {
      finish = () => resolve(animation)
      reject = () => fail(new Error("cancelled"))
    })

    const partial: Partial<Animation> = { finished, cancel: mock(() => reject()) }
    // SAFETY: the motion library only uses finished and cancel() on the animations it starts.
    const animation = partial as Animation
    animations.push({ animation, finish, reject, frames: Array.isArray(keyframes) ? keyframes : [] })

    return animation
  }
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  // Finish single-shot jobs and cancel pending arrivals before restoring globals.
  preference(true)

  for (const animation of animations) animation.reject()

  for (let i = 0; i < 3 && frames.size; i++) frame()
  document.body.replaceChildren()
  mock.restore()
  Element.prototype.animate = originalAnimate
  stubbed.forEach((name, index) => Object.assign(globalThis, { [name]: originals[index] }))
})

describe("DOM animation and Solid", () => {
  it("caches matchMedia without caching the live preference value", () => {
    const spy = spyOn(globalThis, "matchMedia")

    for (let i = 0; i < 100; i++) expect(prefersReducedMotion()).toBe(false)
    reduced = true
    expect(prefersReducedMotion()).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it("springStyle writes DOM without rerunning target computations each frame", async () => {
    const el = attach()
    let set!: (value: number) => void
    let calls = 0
    createRoot((dispose) => {
      cleanups.push(dispose)
      const [value, setter] = createSignal(0)
      set = setter
      springStyle(
        () => el,
        () => {
          calls++

          return { x: value() }
        },
        (node, numbers) => {
          node.style.transform = `translateX(${numbers.x}px)`
        },
      )
    })
    await Promise.resolve()
    frame()
    expect(el.style.transform).toBe("translateX(0px)")
    set(100)
    await Promise.resolve()
    const targetCalls = calls

    for (let i = 0; i < 15; i++) frame()
    expect(calls).toBe(targetCalls)
    expect(el.style.transform).not.toBe("translateX(0px)")
    preference(true)
    frame()
    expect(el.style.transform).toBe("translateX(100px)")
    expect(frames.size).toBe(0)
  })
  it("measures highlights before other frame writes and snaps on first run", async () => {
    const host = attach(),
      selected = attach(),
      highlight = attach()

    host.append(selected, highlight)
    Object.defineProperties(selected, { offsetTop: { value: 35 }, offsetHeight: { value: 48 } })
    let reads = 0
    Object.defineProperty(selected, "offsetLeft", {
      get: () => {
        reads++

        return 0
      },
    })
    createRoot((dispose) => {
      cleanups.push(dispose)
      slidingHighlight({ container: () => host, selected: () => selected, highlight: () => highlight })
    })
    await Promise.resolve()
    frameLoop.add(() => {
      expect(reads).toBeGreaterThan(0)

      return false
    })
    frame()
    expect(highlight.style.height).toBe("48px")
    expect(highlight.style.transform).toBe("translate3d(0px,35px,0)")

    for (let i = 0; i < 60; i++) frame()
    const settledReads = reads
    frame()
    expect(reads).toBe(settledReads)
  })
  it("lands highlights and spring styles while snap() is true instead of travelling", async () => {
    const host = attach(),
      a = attach(),
      b = attach(),
      highlight = attach(),
      styled = attach()

    host.append(a, b, highlight)
    Object.defineProperties(a, {
      offsetTop: { value: 0 },
      offsetHeight: { value: 30 },
      offsetLeft: { value: 0 },
      offsetWidth: { value: 100 },
    })
    Object.defineProperties(b, {
      offsetTop: { value: 200 },
      offsetHeight: { value: 30 },
      offsetLeft: { value: 0 },
      offsetWidth: { value: 100 },
    })
    let snapping = false
    let pick!: (el: HTMLElement) => void, target!: (n: number) => void
    createRoot((dispose) => {
      cleanups.push(dispose)
      const [selected, setSelected] = createSignal<HTMLElement>(a)
      pick = setSelected
      const [width, setWidth] = createSignal(10)
      target = setWidth
      slidingHighlight({ container: () => host, selected, highlight: () => highlight, snap: () => snapping })
      springStyle(
        () => styled,
        () => ({ width: width() }),
        (el, v) => {
          el.style.width = `${v.width}px`
        },
        { snap: () => snapping },
      )
    })
    await Promise.resolve()
    frame()
    pick(b)
    target(90)
    await Promise.resolve()
    frame()
    expect(highlight.style.transform).not.toBe("translate3d(0px,200px,0)")
    expect(styled.style.width).not.toBe("90px")

    for (let i = 0; i < 60; i++) frame()
    snapping = true
    pick(a)
    target(10)
    await Promise.resolve()
    frame()
    expect(highlight.style.transform).toBe("translate3d(0px,0px,0)")
    expect(styled.style.width).toBe("10px")
  })
  it("takes each trip’s curve from its distance when given one", async () => {
    const host = attach(),
      a = attach(),
      b = attach(),
      highlight = attach()

    host.append(a, b, highlight)
    Object.defineProperties(a, {
      offsetTop: { value: 0 },
      offsetHeight: { value: 30 },
      offsetLeft: { value: 0 },
      offsetWidth: { value: 100 },
    })
    Object.defineProperties(b, {
      offsetTop: { value: 1000 },
      offsetHeight: { value: 30 },
      offsetLeft: { value: 0 },
      offsetWidth: { value: 100 },
    })
    const asked: number[] = []
    let pick!: (el: HTMLElement) => void
    createRoot((dispose) => {
      cleanups.push(dispose)
      const [selected, setSelected] = createSignal<HTMLElement>(a)
      pick = setSelected
      slidingHighlight({
        container: () => host,
        selected,
        highlight: () => highlight,
        spring: (distance) => {
          asked.push(distance)

          return { duration: 0.7, bounce: 0 }
        },
      })
    })
    await Promise.resolve()
    frame()
    pick(b)
    await Promise.resolve()
    frame()
    expect(asked.at(-1)).toBe(1000)

    // 0.7 s at no bounce: after 100 ms it is well short of halfway.
    for (let i = 0; i < 5; i++) frame()
    const y = Number(highlight.style.transform.match(/,([\d.]+)px,0\)/)![1])
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(500)

    for (let i = 0; i < 240; i++) frame()
    expect(highlight.style.transform).toBe("translate3d(0px,1000px,0)")
  })
  it("numberTween formats the interpolated number", async () => {
    const el = attach()
    let set!: (value: number) => void
    createRoot((dispose) => {
      cleanups.push(dispose)
      const [value, setter] = createSignal(1)
      set = setter
      numberTween({ ref: () => el, value, format: (n) => n.toFixed(2) })
    })
    await Promise.resolve()
    frame()
    expect(el.textContent).toBe("1.00")
    set(2)
    await Promise.resolve()
    frame()
    expect(Number(el.textContent)).toBeGreaterThan(1)
    preference(true)
    frame()
    expect(el.textContent).toBe("2.00")
  })
  it("widthMorph measures max-content, preserves four-pixel insets, and removes clones", async () => {
    const el = attach(),
      content = attach()

    el.append(content)
    content.textContent = "Choose 1"
    spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 120, 40))
    createRoot((dispose) => {
      cleanups.push(dispose)
      widthMorph({ ref: () => el, content: () => content })
    })
    await Promise.resolve()
    frame()
    expect(el.style.width).toBe("128px")
    expect(content.style.width).toBe("100%")
    expect(el.children.length).toBe(1)
  })
  it("WAAPI entrances and FLIP respect reduced motion and interruption", async () => {
    const el = attach()
    enter(el)
    el.style.opacity = "0.4"
    el.style.transform = "translateX(10px)"
    enter(el, { scale: 0.9 })
    expect(animations[0]!.animation.cancel).toHaveBeenCalled()
    expect(animations[1]!.frames[0]?.opacity).toBe("0.4")
    expect(animations[1]!.frames[0]?.transform).toBe("translateX(10px)")
    preference(true)
    expect(animations[1]!.animation.cancel).toHaveBeenCalled()
    enter(el)
    slideFrom(el, new DOMRect(0, 0, 100, 50))
    expect(animations.length).toBe(2)
    await Promise.resolve()
  })
  it("FLIP cancels the prior transform before measuring its destination", () => {
    const el = attach()
    enter(el)
    spyOn(el, "getBoundingClientRect").mockImplementation(() => {
      expect(animations[0]!.animation.cancel).toHaveBeenCalled()

      return new DOMRect(20, 30, 200, 100)
    })
    slideFrom(el, new DOMRect(0, 0, 100, 50))
    expect(animations[1]!.frames[0]?.transform).toBe("translate3d(-20px,-30px,0) scale(0.5,0.5)")
  })
})
