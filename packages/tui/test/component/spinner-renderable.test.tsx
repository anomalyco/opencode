/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, type JSX } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import type { ColorGenerator, SpinnerRenderable } from "../../src/component/spinner-renderable"
import "../../src/component/spinner-renderable"

const RED = RGBA.fromInts(255, 0, 0)
const GREEN = RGBA.fromInts(0, 255, 0)
const BLUE = RGBA.fromInts(0, 0, 255)

async function mount(spinner: () => JSX.Element) {
  const clock = new ManualClock()
  const app = await testRender(
    () => (
      <box flexDirection="row" backgroundColor={BLUE}>
        {spinner()}
        <text>|</text>
      </box>
    ),
    { width: 12, height: 1, clock },
  )
  await app.renderOnce()
  return Object.assign(app, {
    clock,
    async step(ms: number) {
      clock.advance(ms)
      await app.renderOnce()
      return app.captureCharFrame().split("|")[0]!.trimEnd()
    },
  })
}

test.each([
  { name: "advances one frame per elapsed interval", autoplay: true, steps: [79, 1, 80, 160], frames: "abcb" },
  { name: "holds the first frame without autoplay", autoplay: false, steps: [80, 160], frames: "aa" },
])("$name", async (item) => {
  await using spinner = await mount(() => <spinner frames={["a", "b", "c"]} interval={80} autoplay={item.autoplay} />)
  expect(spinner.captureCharFrame()).toStartWith("a|")
  for (const [index, ms] of item.steps.entries()) expect(await spinner.step(ms)).toBe(item.frames[index]!)
})

test("frames, autoplay, and visibility changes restart the frame clock", async () => {
  const [frames, setFrames] = createSignal(["a", "b", "c"])
  const [autoplay, setAutoplay] = createSignal(true)
  const [visible, setVisible] = createSignal(true)
  await using spinner = await mount(() => (
    <box visible={visible()}>
      <spinner frames={frames()} interval={80} autoplay={autoplay()} />
    </box>
  ))
  expect(await spinner.step(80)).toBe("b")

  setFrames(["x", "y"])
  expect(await spinner.step(0)).toBe("x")
  expect(await spinner.step(80)).toBe("y")

  setAutoplay(false)
  expect(await spinner.step(200)).toBe("y")
  setAutoplay(true)
  // Paused time does not count toward the next frame.
  expect(await spinner.step(50)).toBe("y")
  expect(await spinner.step(79)).toBe("y")
  expect(await spinner.step(1)).toBe("x")

  setVisible(false)
  await spinner.step(1000)
  expect(spinner.clock.pendingTimerCount).toBe(0)
  setVisible(true)
  expect(await spinner.step(40)).toBe("x")
  expect(await spinner.step(79)).toBe("x")
  expect(await spinner.step(1)).toBe("y")
})

test("requests its own frames while leaving the renderer idle, and stops when destroyed", async () => {
  const [shown, setShown] = createSignal(true)
  await using spinner = await mount(() => (
    <Show when={shown()}>
      <spinner frames={["a", "b"]} interval={80} />
    </Show>
  ))
  expect(spinner.renderer.root.liveCount).toBe(0)
  spinner.clock.advance(80)
  await spinner.renderer.idle()
  expect(spinner.captureCharFrame()).toStartWith("b|")
  expect(spinner.clock.pendingTimerCount).toBe(1)

  setShown(false)
  await spinner.renderOnce()
  expect(spinner.clock.pendingTimerCount).toBe(0)
})

test.each([
  { frames: ["-"], width: 1 },
  { frames: ["-", "abc", "ab"], width: 3 },
  { frames: ["界"], width: 2 },
  { frames: ["a", "界界"], width: 4 },
  { frames: ["👍🏽"], width: 2 },
])("measures the widest frame by display width: $frames", async (item) => {
  let node: SpinnerRenderable | undefined
  await using _ = await mount(() => <spinner ref={(value) => (node = value)} frames={[...item.frames]} />)
  expect(node?.width).toBe(item.width)
  expect(node?.height).toBe(1)
})

test("paints per-character generator colors over the parent background", async () => {
  const calls: number[][] = []
  const color: ColorGenerator = (frame, char, frames, chars) => {
    calls.push([frame, char, frames, chars])
    return char === 0 ? RED : "#00ff00"
  }
  await using spinner = await mount(() => <spinner frames={["a👍🏽b", "cd"]} interval={80} color={color} />)
  expect(calls.slice(-3)).toEqual([
    [0, 0, 2, 3],
    [0, 1, 2, 3],
    [0, 2, 2, 3],
  ])
  const spans = spinner.captureSpans().lines[0]!.spans
  expect(spans.slice(0, 2).map((span) => [span.text, span.fg.equals(RED), span.fg.equals(GREEN)])).toEqual([
    ["a", true, false],
    ["👍🏽b", false, true],
  ])
  expect(spans.slice(0, 2).every((span) => span.bg.equals(BLUE))).toBe(true)
})

test("paints a static color and an explicit background", async () => {
  await using spinner = await mount(() => <spinner frames={["ab"]} color={RED} backgroundColor={GREEN} />)
  const span = spinner.captureSpans().lines[0]!.spans[0]!
  expect([span.text, span.fg.equals(RED), span.bg.equals(GREEN)]).toEqual(["ab", true, true])
})
