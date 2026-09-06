/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { ManualClock } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { createAnimatable, spring, tween } from "../../src/ui/animation"

test("tweens advance together on renderer frames and release the renderer when settled", async () => {
  const clock = new ManualClock()
  const motions: ReturnType<typeof createAnimatable<{ value: number }>>[] = []
  const app = await testRender(
    () => {
      const first = createAnimatable({ value: 0 }, { transition: tween({ duration: 0.1 }) })
      const second = createAnimatable({ value: 0 }, { transition: tween({ duration: 0.1 }) })
      motions.push(first, second)
      return (
        <text>
          {first.value().value} {second.value().value}
        </text>
      )
    },
    { clock, targetFps: 20, maxFps: 20, width: 20, height: 1 },
  )

  try {
    await app.renderOnce()
    motions.forEach((motion) => motion.animate({ value: 1 }))
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    expect(app.renderer.isRunning).toBe(true)

    clock.advance(49)
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    expect(motions.map((motion) => motion.value().value)).toEqual([0, 0])
    clock.advance(1)
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    expect(motions.map((motion) => motion.value().value)).toEqual([0.5, 0.5])
    expect(app.captureCharFrame()).toContain("0.5 0.5")

    clock.advance(50)
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    expect(motions.map((motion) => motion.value().value)).toEqual([1, 1])
    expect(app.renderer.isRunning).toBe(false)

    motions[0]!.animate({ value: 0 })
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    expect(app.renderer.isRunning).toBe(true)
    motions[0]!.jump({ value: 0 })
    expect(app.renderer.isRunning).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("springs settle on renderer frames and disabled or disposed animations stop", async () => {
  const clock = new ManualClock()
  const [enabled, setEnabled] = createSignal(true)
  const [mounted, setMounted] = createSignal(true)
  let motion!: ReturnType<typeof createAnimatable<{ value: number }>>
  const app = await testRender(
    () => (
      <Show when={mounted()}>
        {(() => {
          motion = createAnimatable({ value: 0 }, { enabled, transition: spring({ visualDuration: 0.2 }) })
          return <text>{motion.value().value}</text>
        })()}
      </Show>
    ),
    { clock, targetFps: 50, maxFps: 50, width: 20, height: 1 },
  )

  try {
    await app.renderOnce()
    motion.animate({ value: 1 })
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    for (let frame = 0; frame < 60; frame++) {
      clock.advance(20)
      await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    }
    expect(motion.value().value).toBe(1)
    expect(app.renderer.isRunning).toBe(false)

    motion.animate({ value: 2 })
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    setEnabled(false)
    expect(motion.value().value).toBe(2)
    expect(app.renderer.isRunning).toBe(false)

    setEnabled(true)
    motion.animate({ value: 3 })
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    expect(app.renderer.isRunning).toBe(true)
    setMounted(false)
    expect(app.renderer.isRunning).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})
