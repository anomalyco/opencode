import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { mountGoUpsellHero } from "./go-upsell-hero-art"

const original = {
  matchMedia: window.matchMedia,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
}

let frames: Map<number, FrameRequestCallback>

let mediaListeners: number

let queries: Query[]

class Query extends EventTarget {
  onchange = null

  constructor(
    readonly matches: boolean,
    readonly media: string,
  ) {
    super()
  }

  addListener() {}

  removeListener() {}

  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    mediaListeners++
    super.addEventListener(...args)
  }

  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {
    mediaListeners--
    super.removeEventListener(...args)
  }
}

function prefersReducedMotion(matches: boolean) {
  window.matchMedia = (query) => {
    const media = new Query(matches, query)
    queries.push(media)

    return media
  }
}

function pixelRatio(value: number) {
  Object.defineProperty(window, "devicePixelRatio", { value, configurable: true })
}

function hero() {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  const count = { frames: 0, draws: 0, cells: 0 }
  // The steady loop and the still put each frame as one image; the intro composites layers with drawImage.
  ctx.putImageData = () => count.frames++
  ctx.drawImage = () => count.draws++
  ctx.fillRect = () => count.cells++
  spyOn(canvas, "getContext").mockReturnValue(ctx)
  Object.defineProperties(canvas, { clientWidth: { value: 480 }, clientHeight: { value: 176 } })
  document.body.append(canvas)

  return { canvas, count }
}

beforeEach(() => {
  frames = new Map()
  mediaListeners = 0
  queries = []
  pixelRatio(1)
  let id = 0
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++id, callback)

    return id
  }

  globalThis.cancelAnimationFrame = (handle) => {
    frames.delete(handle)
  }
})

afterEach(() => {
  window.matchMedia = original.matchMedia
  globalThis.requestAnimationFrame = original.requestAnimationFrame
  globalThis.cancelAnimationFrame = original.cancelAnimationFrame
  document.body.replaceChildren()
  document.documentElement.removeAttribute("data-motion")
  pageHidden(false)
})

function pageHidden(value: boolean) {
  Object.defineProperty(document, "hidden", { value, configurable: true })
}

test("the app's Reduce Motion setting stops the loop and draws one still frame", async () => {
  prefersReducedMotion(false)
  const { canvas, count } = hero()

  const dispose = mountGoUpsellHero(canvas)
  expect(frames.size).toBe(1)
  expect(count.frames).toBe(0)

  document.documentElement.setAttribute("data-motion", "reduce")
  // MutationObserver callbacks run as a microtask.
  await Promise.resolve()
  expect(frames.size).toBe(0)
  expect(count.frames).toBe(1)
  dispose()
})

test("a hidden page draws nothing when its size or theme changes", async () => {
  prefersReducedMotion(true)
  pageHidden(true)
  const { canvas, count } = hero()

  const dispose = mountGoUpsellHero(canvas)
  expect(count.frames).toBe(0)

  document.documentElement.setAttribute("data-theme", "other")
  await Promise.resolve()
  pixelRatio(2)
  queries.find((query) => query.media === "(resolution: 1dppx)")!.dispatchEvent(new Event("change"))
  expect(count.frames).toBe(0)

  pageHidden(false)
  document.dispatchEvent(new Event("visibilitychange"))
  expect(count.frames).toBe(1)
  expect(canvas.width).toBe(960)
  dispose()
})

test("draws one still frame and runs no loop under reduced motion", () => {
  prefersReducedMotion(true)
  const { canvas, count } = hero()

  const dispose = mountGoUpsellHero(canvas)

  expect(count.frames).toBe(1)
  // GO's cells; the grid is part of the image
  expect(count.cells).toBe(140)
  expect(canvas.width).toBe(480)
  expect(frames.size).toBe(0)
  dispose()
})

test("redraws the still at a new pixel ratio", () => {
  prefersReducedMotion(true)
  const { canvas, count } = hero()

  const dispose = mountGoUpsellHero(canvas)
  expect(canvas.width).toBe(480)

  pixelRatio(2)
  queries.find((query) => query.media === "(resolution: 1dppx)")!.dispatchEvent(new Event("change"))
  expect(canvas.width).toBe(960)
  expect(canvas.height).toBe(352)
  expect(count.frames).toBe(2)

  // The query is re-armed for the new ratio, so moving back is caught too.
  pixelRatio(1)
  queries.find((query) => query.media === "(resolution: 2dppx)")!.dispatchEvent(new Event("change"))
  expect(canvas.width).toBe(480)
  dispose()
  expect(mediaListeners).toBe(0)
})

test("stops the loop and its listeners when unmounted", () => {
  prefersReducedMotion(false)
  const { canvas, count } = hero()

  const dispose = mountGoUpsellHero(canvas)
  expect(frames.size).toBe(1)
  // Reduced motion and pixel ratio
  expect(mediaListeners).toBe(2)

  const [id, tick] = [...frames][0]!
  frames.delete(id)
  tick(performance.now() + 16)
  expect(count.draws).toBeGreaterThan(0)
  expect(frames.size).toBe(1)

  dispose()
  expect(frames.size).toBe(0)
  expect(mediaListeners).toBe(0)

  const draws = count.draws
  document.dispatchEvent(new Event("visibilitychange"))
  expect(frames.size).toBe(0)
  expect(count.draws).toBe(draws)
})
