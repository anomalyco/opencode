/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { SpinnerRenderable } from "opentui-spinner"
import { createSignal } from "solid-js"
import { OneCellSpinner } from "../../src/component/one-cell-spinner"
import {
  BLOCK_LOW_COMET,
  BLOCK_SOFT_SWEEP,
  oneCellFrame,
  SEED_LAUNCH,
  SEED_MONO,
  SEED_WORK,
} from "../../src/ui/one-cell-motion"
import { octantGlyph } from "../../src/ui/subcell"
import { stringWidth } from "../../src/util/string-width"

test("work has a 3.2s intro with a 400-1200ms peak and a smooth handoff", () => {
  for (const [age, level] of [
    [0, 0.3],
    [200, 0.65],
    [1600, 0.6584],
    [2400, 0.3448],
  ]) {
    expect(oneCellFrame(SEED_WORK, age).level).toBeCloseTo(level)
  }
  expect(oneCellFrame(SEED_WORK, 399).level).toBeLessThan(1)
  for (let age = 400; age <= 1200; age += 40) {
    expect(oneCellFrame(SEED_WORK, age)).toEqual({ glyph: "\u25aa", level: 1, complete: false })
  }
  expect(oneCellFrame(SEED_WORK, 1240).level).toBeLessThan(1)
  expect(oneCellFrame(SEED_WORK, 3199).level).toBeCloseTo(0.3, 4)
  expect(oneCellFrame(SEED_WORK, 3200)).toEqual({ glyph: "\u25aa", level: 0.3, complete: false })
  expect(oneCellFrame(SEED_WORK, 3231).level).toBe(0.3)
  expect(oneCellFrame(SEED_WORK, 3232).level).toBeGreaterThan(0.3)
  expect(oneCellFrame(SEED_WORK, 3840).level).toBe(1)
  expect(oneCellFrame(SEED_WORK, 4480).level).toBe(0.3)
})

test("work slows continuously from 1.28s breaths to 3.2s breaths between ages 30s and 60s", () => {
  const peaks = Array.from({ length: 66_000 }, (_, index) => 3200 + index).filter(
    (age) => oneCellFrame(SEED_WORK, age).level === 1 && oneCellFrame(SEED_WORK, age - 1).level < 1,
  )
  const cycles = peaks.slice(1).map((age, index) => ({ start: peaks[index], age, duration: age - peaks[index] }))
  const early = cycles.filter((cycle) => cycle.age <= 30_000)
  const slowing = cycles.filter((cycle) => cycle.age > 30_000 && cycle.start < 60_000)
  const late = cycles.filter((cycle) => cycle.start >= 60_000)

  expect(early.length).toBeGreaterThan(1)
  expect(early.every((cycle) => cycle.duration === 1280)).toBe(true)
  expect(slowing[0].duration).toBeGreaterThan(1280)
  expect(slowing[0].duration).toBeLessThan(1290)
  expect(slowing.at(-1)!.duration).toBeGreaterThan(3100)
  expect(slowing.at(-1)!.duration).toBeLessThan(3200)
  expect(slowing.slice(1).every((cycle, index) => cycle.duration > slowing[index].duration)).toBe(true)
  expect(late.length).toBeGreaterThan(1)
  expect(late.every((cycle) => cycle.duration === 3200)).toBe(true)
  for (const age of [30_000, 60_000]) {
    expect(oneCellFrame(SEED_WORK, age - 1)).toEqual(oneCellFrame(SEED_WORK, age))
    expect(oneCellFrame(SEED_WORK, age + 1)).toEqual(oneCellFrame(SEED_WORK, age))
  }
})

test("launch fills the seed and lands at full brightness at 800ms without looping", () => {
  expect(oneCellFrame(SEED_LAUNCH, 0)).toEqual({ glyph: "\u25ab", level: 0.3, complete: false })
  expect(oneCellFrame(SEED_LAUNCH, 399).glyph).toBe("\u25ab")
  expect(oneCellFrame(SEED_LAUNCH, 400).glyph).toBe("\u25aa")
  expect(oneCellFrame(SEED_LAUNCH, 799).level).toBeLessThan(1)
  expect(oneCellFrame(SEED_LAUNCH, 799).complete).toBe(false)
  for (const age of [800, 840, 3200, 60_000]) {
    expect(oneCellFrame(SEED_LAUNCH, age)).toEqual({ glyph: "\u25aa", level: 1, complete: true })
  }
})

test("low comet preserves its lower-six tapered trail without an intro or brightness pulse", () => {
  const poses = [
    [0x54, 0x14],
    [0x1c, 0x0c],
    [0x2c, 0x28],
    [0xa8, 0xa0],
    [0xe0, 0xc0],
    [0xd0, 0x50],
  ]
  expect(BLOCK_LOW_COMET.frames).toEqual(
    poses.flatMap(([full, leading]) => [full, full, full, leading, leading].map(octantGlyph)),
  )
  expect(BLOCK_LOW_COMET.intro).toBeUndefined()
  expect(BLOCK_LOW_COMET.levels).toBeUndefined()
  expect(BLOCK_LOW_COMET.frames.length * BLOCK_LOW_COMET.interval).toBe(1200)
  expect(oneCellFrame(BLOCK_LOW_COMET, 0)).toEqual({ glyph: octantGlyph(0x54), level: 1, complete: false })
  expect(oneCellFrame(BLOCK_LOW_COMET, 99).glyph).toBe(octantGlyph(0x54))
  expect(oneCellFrame(BLOCK_LOW_COMET, 100).glyph).toBe(octantGlyph(0x14))
  expect(oneCellFrame(BLOCK_LOW_COMET, 166).glyph).toBe(octantGlyph(0x14))
  expect(oneCellFrame(BLOCK_LOW_COMET, 167).glyph).toBe(octantGlyph(0x1c))
})

test("soft sweep crosses the middle four octants and returns along the same path", () => {
  expect(BLOCK_SOFT_SWEEP.frames).toEqual(
    [0x14, 0x14, 0x14, 0x1c, 0x3c, 0x38, 0x28, 0x28, 0x28, 0x38, 0x3c, 0x1c].map(octantGlyph),
  )
  expect(BLOCK_SOFT_SWEEP.intro).toBeUndefined()
  expect(BLOCK_SOFT_SWEEP.levels).toBeUndefined()
  for (const [age, mask] of [
    [0, 0x14],
    [250, 0x1c],
    [500, 0x28],
    [750, 0x38],
    [1000, 0x14],
  ]) {
    expect(oneCellFrame(BLOCK_SOFT_SWEEP, age)).toEqual({ glyph: octantGlyph(mask), level: 1, complete: false })
  }
})

test.each([
  ["comet", BLOCK_LOW_COMET],
  ["sweep", BLOCK_SOFT_SWEEP],
] as const)("%s slows from 1000ms to 1250ms cycles without resetting phase at 30 or 60 seconds", (_, animation) => {
  const constant = { ...animation, pace: undefined }
  for (const [age, phase] of [
    [0, 0],
    [30_000, 36_000],
    [45_000, 53_325],
    [60_000, 68_400],
    [70_000, 78_000],
  ]) {
    expect(oneCellFrame(animation, age)).toEqual(oneCellFrame(constant, phase))
  }
  for (const age of [100, 200, 300, 400, 500]) {
    expect(oneCellFrame(animation, age)).toEqual(oneCellFrame(animation, age + 1000))
    expect(oneCellFrame(animation, age + 60_000)).toEqual(oneCellFrame(animation, age + 61_250))
  }
})

test.each([
  ["sweep", BLOCK_SOFT_SWEEP],
  ["comet", BLOCK_LOW_COMET],
  ["work", SEED_WORK],
  ["launch", SEED_LAUNCH],
  ["mono", SEED_MONO],
] as const)("%s frames always occupy one terminal cell", (_, animation) => {
  for (const glyph of [...animation.frames, ...(animation.intro?.frames ?? [])]) {
    expect(stringWidth(glyph)).toBe(1)
  }
  for (const age of [0, 40, 120, 399, 400, 799, 800, 1200, 3199, 3200, 30_000, 45_000, 60_000, 63_700]) {
    const frame = oneCellFrame(animation, age)
    expect(stringWidth(frame.glyph)).toBe(1)
    expect(frame.level).toBeGreaterThanOrEqual(0.3)
    expect(frame.level).toBeLessThanOrEqual(1)
  }
})

test.each([
  ["sweep", BLOCK_SOFT_SWEEP, RGBA.fromIndex(214, "#b08040cc"), [0, 250, 500, 750, 1000, 30_000, 45_000, 60_000]],
  ["comet", BLOCK_LOW_COMET, RGBA.fromIndex(214, "#b08040cc"), [0, 80, 160, 640, 30_000, 45_000, 60_000]],
  ["work", SEED_WORK, RGBA.fromIndex(214, "#b08040cc"), [0, 400, 1200, 3200, 3840, 45_000, 60_000]],
  ["launch", SEED_LAUNCH, RGBA.defaultForeground("#b08040cc"), [0, 200, 400, 799, 800, 60_000]],
] as const)(
  "paused %s age samples keep one cell and clone the color without losing terminal intent",
  async (_, animation, color, ages) => {
    const original = RGBA.clone(color)
    const [age, setAge] = createSignal(0)
    const [glow, setGlow] = createSignal(true)
    const app = await testRender(
      () => (
        <box flexDirection="row">
          <text>[</text>
          <OneCellSpinner animation={animation} color={color} paused age={age()} glow={glow()} />
          <text>]</text>
        </box>
      ),
      { width: 3, height: 1 },
    )

    try {
      await app.renderOnce()
      const paused = app.captureSpans()
      await Bun.sleep(160)
      await app.renderOnce()
      expect(app.captureSpans()).toEqual(paused)
      for (const sample of ages) {
        setAge(sample)
        await app.renderOnce()
        const frame = oneCellFrame(animation, sample)
        expect(app.captureCharFrame().trim()).toBe(`[${frame.glyph}]`)
        expect(app.captureSpans().lines[0].spans.find((span) => span.text === frame.glyph)?.width).toBe(1)
        const spinner = app.renderer.root.getChildren()[0].getChildren()[1].getChildren()[0] as SpinnerRenderable
        expect(spinner).toBeInstanceOf(SpinnerRenderable)
        expect(spinner.width).toBe(1)
        const ink = spinner.color as RGBA
        expect(ink).toBeInstanceOf(RGBA)
        expect(ink).not.toBe(color)
        expect(ink.buffer).not.toBe(color.buffer)
        expect(ink.toInts().slice(0, 3)).toEqual(original.toInts().slice(0, 3))
        expect(ink.a).toBeCloseTo(original.a * frame.level, 2)
        expect(ink.intent).toBe(original.intent)
        expect(ink.slot).toBe(original.slot)
        expect(color.buffer).toEqual(original.buffer)
        expect(app.renderer.root.liveCount).toBe(0)
      }
      setAge(0)
      setGlow(false)
      await app.renderOnce()
      const spinner = app.renderer.root.getChildren()[0].getChildren()[1].getChildren()[0] as SpinnerRenderable
      expect(spinner.color).toEqual(original)
    } finally {
      app.renderer.destroy()
    }
  },
)

test("disabled animations keep a full-color one-cell fallback, including monochrome", async () => {
  const color = RGBA.defaultForeground("#b08040")
  const original = RGBA.clone(color)
  const [animation, setAnimation] = createSignal(SEED_WORK)
  const [age, setAge] = createSignal(0)
  const [still, setStill] = createSignal<string>()
  const app = await testRender(
    () => <OneCellSpinner animation={animation()} color={color} animations={false} age={age()} still={still()} />,
    { width: 3, height: 1 },
  )

  try {
    for (const motion of [BLOCK_SOFT_SWEEP, BLOCK_LOW_COMET, SEED_WORK, SEED_LAUNCH, SEED_MONO]) {
      setAnimation(motion)
      for (const sample of [0, 800, 3840, 60_000]) {
        setAge(sample)
        for (const glyph of [undefined, "-"]) {
          setStill(glyph)
          await app.renderOnce()
          expect(app.captureCharFrame().trim()).toBe(glyph ?? "\u25aa")
          expect(app.captureSpans().lines[0].spans[0].width).toBe(1)
          const box = app.renderer.root.getChildren()[0]
          expect(box.width).toBe(1)
          const text = box.getChildren()[0] as TextRenderable
          expect(text).toBeInstanceOf(TextRenderable)
          expect(text.fg).toEqual(original)
          expect(color.buffer).toEqual(original.buffer)
          expect(app.renderer.root.liveCount).toBe(0)
        }
      }
    }
  } finally {
    app.renderer.destroy()
  }
})

test.each([
  ["sweep", BLOCK_SOFT_SWEEP],
  ["comet", BLOCK_LOW_COMET],
  ["work", SEED_WORK],
  ["launch", SEED_LAUNCH],
  ["mono", SEED_MONO],
] as const)("animated %s advances without holding the renderer live or blocking idle", async (_, animation) => {
  const app = await testRender(() => <OneCellSpinner animation={animation} color="#b08040" />, { width: 3, height: 1 })

  try {
    await app.renderOnce()
    const before = app.captureSpans()
    await Bun.sleep(320)
    expect(app.renderer.isRunning).toBe(false)
    expect(await Promise.race([app.renderer.idle().then(() => "idle"), Bun.sleep(1000).then(() => "blocked")])).toBe(
      "idle",
    )
    expect(app.renderer.root.liveCount).toBe(0)
    expect(app.captureSpans()).not.toEqual(before)
    expect(stringWidth(app.captureCharFrame().trim())).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})
