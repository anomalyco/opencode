import { expect, test } from "bun:test"
/** @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import {
  TabPulse,
  blendTabPulseColor,
  completionPulseOpacity,
  glowIgnitionLevel,
  tabFlashIntensity,
  unreadGlowIntensity,
} from "../../src/component/tab-pulse"
import { tint } from "../../src/theme/color"

const BACKGROUND = RGBA.fromHex("#101010")

async function mount(
  props: () => { active: boolean; enabled?: boolean; glow?: boolean; onLevel?: (level: number) => void },
) {
  const clock = new ManualClock()
  const app = await testRender(
    () => (
      <TabPulse
        enabled={props().enabled}
        active={props().active}
        glow={props().glow}
        color={RGBA.fromHex("#ffcc00")}
        backgroundColor={BACKGROUND}
        onLevel={props().onLevel}
      />
    ),
    { width: 10, height: 1, clock },
  )
  let frames = 0
  app.renderer.on("frame", () => frames++)
  await app.renderOnce()
  return Object.assign(app, {
    clock,
    /** Advances the clock in 5 ms steps, drawing another frame every `other` ms, and counts the frames. */
    async run(ms: number, other = 0) {
      frames = 0
      for (let elapsed = 5; elapsed <= ms; elapsed += 5) {
        clock.advance(5)
        if (other && elapsed % other === 0) await app.renderOnce()
        await Bun.sleep(0)
        await Bun.sleep(0)
      }
      return frames
    },
    colors() {
      return app.captureSpans().lines[0]!.spans.flatMap((span) => Array(span.width).fill(span.bg.buffer.join()))
    },
  })
}

test("a disabled pulse stays idle when it becomes active", async () => {
  const [active, setActive] = createSignal(false)
  await using pulse = await mount(() => ({ active: active(), enabled: false }))
  setActive(true)
  expect(await pulse.run(500)).toBe(1)
  expect(pulse.renderer.root.liveCount).toBe(0)
  expect(pulse.clock.pendingTimerCount).toBe(0)
})

test("an attention glow becomes idle after ignition", async () => {
  await using pulse = await mount(() => ({ active: false, glow: true }))
  expect(pulse.clock.pendingTimerCount).toBe(1)
  await pulse.run(650)
  expect(pulse.clock.pendingTimerCount).toBe(0)
  expect(await pulse.run(500)).toBe(0)
})

test.each([
  // A requested frame draws asynchronously, on the same 5 ms clock step or a later one depending on the event loop,
  // so frames alone come 50 to 55 ms apart.
  { name: "alone", other: 0, min: 18, max: 20 },
  { name: "beside a 25 fps animation", other: 40, min: 25, max: 25 },
  { name: "beside a 50 fps animation", other: 20, min: 50, max: 50 },
])("a running pulse adds frames only up to 20 fps, $name", async (item) => {
  await using pulse = await mount(() => ({ active: true }))
  const frames = await pulse.run(1000, item.other)
  expect(frames).toBeGreaterThanOrEqual(item.min)
  expect(frames).toBeLessThanOrEqual(item.max)
  expect(pulse.renderer.root.liveCount).toBe(0)
})

test("a running pulse changes its level at most 20 times a second while the renderer draws at 50 fps", async () => {
  const levels: number[] = []
  await using pulse = await mount(() => ({ active: true, onLevel: (level) => levels.push(level) }))
  expect(await pulse.run(2000, 20)).toBe(100)
  expect(levels.length).toBeGreaterThan(10)
  expect(levels.length).toBeLessThanOrEqual(40)
})

test("the sweep shows the same colors at the same time at any frame rate", async () => {
  await using slow = await mount(() => ({ active: true }))
  await using fast = await mount(() => ({ active: true }))
  for (const ms of [300, 700, 1400, 2800]) {
    await slow.run(ms)
    await fast.run(ms, 20)
    await slow.renderOnce()
    await fast.renderOnce()
    expect(slow.colors()).toEqual(fast.colors())
    expect(new Set(slow.colors()).size).toBeGreaterThan(1)
  }
})

test("a pulse stops requesting frames when the run ends", async () => {
  const [active, setActive] = createSignal(true)
  await using pulse = await mount(() => ({ active: active() }))
  await pulse.run(1000)
  setActive(false)
  await pulse.run(1000)
  expect(pulse.clock.pendingTimerCount).toBe(0)
  expect(await pulse.run(1000)).toBe(0)
  expect(new Set(pulse.colors()).size).toBe(1)
})

test("completion pulse rises quickly and fades over the remaining duration", () => {
  expect(completionPulseOpacity(0)).toBe(0)
  expect(completionPulseOpacity(0.06)).toBeCloseTo(0.5)
  expect(completionPulseOpacity(0.12)).toBe(1)
  expect(completionPulseOpacity(0.56)).toBeCloseTo(0.5)
  expect(completionPulseOpacity(1)).toBe(0)
})

test("glow ignition overshoots the resting level and settles back to it", () => {
  expect(glowIgnitionLevel(0)).toBe(0)
  expect(glowIgnitionLevel(0.3)).toBeCloseTo(1.5)
  expect(glowIgnitionLevel(0.6)).toBeGreaterThan(1)
  expect(glowIgnitionLevel(1)).toBe(1)
})

test("unread glow peaks behind the tab number and fades to the normal background", () => {
  const intensities = Array.from({ length: 22 }, (_, index) => unreadGlowIntensity(index, 22))

  expect(intensities[0]).toBe(1)
  expect(intensities[1]).toBe(1)
  expect(intensities[2]).toBeLessThan(1)
  expect(intensities.slice(1)).toEqual(intensities.slice(1).sort((a, b) => b - a))
  expect(intensities[13]).toBe(0)
  expect(intensities.at(-1)).toBe(0)
})

test("unread glow reaches the normal background on compact tabs", () => {
  expect(unreadGlowIntensity(0, 8)).toBe(1)
  expect(unreadGlowIntensity(7, 8)).toBe(0)
})

test("tab flash holds behind the shortcut then feathers to the background", () => {
  const intensities = Array.from({ length: 10 }, (_, index) => tabFlashIntensity(index, 8))

  expect(intensities[0]).toBe(1)
  expect(intensities[1]).toBe(1)
  expect(intensities[2]).toBeLessThan(1)
  expect(intensities.slice(1)).toEqual(intensities.slice(1).sort((a, b) => b - a))
  expect(intensities.at(-1)).toBe(0)
})

test("reuses a color while preserving the original glow and pulse blend stages", () => {
  const output = RGBA.fromInts(0, 0, 0)
  const background = RGBA.fromHex("#1a1b26")
  const glowColor = RGBA.fromHex("#82aaff")
  const runningColor = RGBA.fromHex("#c8d3f5")
  const flashColor = RGBA.fromHex("#e2e8fb")
  const completionColor = RGBA.fromHex("#ff9e64")

  for (const glow of [0, 0.08, 0.16]) {
    for (const running of [0, 0.01, 0.07, 0.14]) {
      for (const flash of [0, 0.05, 0.1]) {
        for (const completion of [0, 0.03, 0.09, 0.18]) {
          blendTabPulseColor(
            output,
            background,
            glowColor,
            runningColor,
            flashColor,
            completionColor,
            glow,
            running,
            flash,
            completion,
          )
          expect(output.buffer).toEqual(
            tint(
              tint(tint(tint(background, glowColor, glow), runningColor, running), flashColor, flash),
              completionColor,
              completion,
            ).buffer,
          )
        }
      }
    }
  }
})
