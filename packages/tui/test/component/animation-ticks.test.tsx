/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, type JSX } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { FadeInText } from "../../src/component/fade-in-text"
import { OneCellSpinner } from "../../src/component/one-cell-spinner"
import { ShimmerText } from "../../src/component/shimmer-text"
import { Spinner, SPINNER_FRAMES } from "../../src/component/spinner"
import "../../src/component/title-shimmer"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { createAnimatable, tween } from "../../src/ui/animation"
import { BLOCK_LOW_COMET, SEED_WORK } from "../../src/ui/one-cell-motion"
import { countTickers } from "../fixture/animation-ticks"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// Mounts `view` on a manual clock and counts frames; each step waits for renderer.idle(), so it also shows that
// the renderer goes idle between ticks while the view animates.
async function mount(view: () => JSX.Element) {
  await using temporary = await tmpdir()
  const clock = new ManualClock()
  const [shown, setShown] = createSignal(true)
  const [visible, setVisible] = createSignal(true)
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Show when={shown()}>
              <box visible={visible()}>{view()}</box>
            </Show>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 20, height: 2, clock, maxFps: Number.POSITIVE_INFINITY },
  )
  let frames = 0
  app.renderer.on("frame", () => frames++)
  return Object.assign(app, {
    clock,
    setShown,
    setVisible,
    async run(ms: number) {
      frames = 0
      for (let elapsed = 5; elapsed <= ms; elapsed += 5) {
        clock.advance(5)
        await app.renderer.idle()
      }
      return frames
    },
  })
}

function Tween() {
  const motion = createAnimatable({ x: 0 }, { transition: tween({ duration: 10 }) })
  motion.animate({ x: 1 })
  return <text>{motion.value().x.toFixed(3)}</text>
}

const SHIMMER = RGBA.fromHex("#ffffff")

// A view → frames over 3 s while it runs, its open tickers, and frames over 1 s hidden with visible={false} (after
// the frame that hides it). Renderables with animationFps stop when not drawn; the Solid hook and tweens are bound to
// no node, so they keep ticking while hidden (their call sites mount them under <Show>). Unmounted, nothing ticks.
const rows: [string, () => JSX.Element, number, number, number][] = [
  ["a spinner at 12.5 fps", () => <Spinner />, 38, 1, 0],
  [
    "a one-cell work spinner at 30 fps",
    () => <OneCellSpinner animation={BLOCK_LOW_COMET} color="#ffffff" />,
    90,
    1,
    30,
  ],
  ["a 10 s tween at 60 fps", () => <Tween />, 180, 1, 60],
  [
    "shimmer text at 60 fps",
    () => (
      <ShimmerText shimmer={SHIMMER} fg="#444444">
        work
      </ShimmerText>
    ),
    180,
    1,
    0,
  ],
  ["a shimmer spinner: 60 fps text, 12.5 fps glyph", () => <Spinner shimmer={SHIMMER}>work</Spinner>, 180, 2, 12],
  [
    "a pending title shimmer at 60 fps",
    () => <title_shimmer content="Untitled" rename={{ title: "Untitled", pending: true }} />,
    180,
    1,
    0,
  ],
]

for (const [name, view, frames, open, hidden] of rows) {
  test(`animation ticks: ${name}; hidden and unmounted`, async () => {
    using tickers = countTickers()
    await using app = await mount(view)
    await app.run(1000)
    // The picture moves: a view whose time stops still gets its frames, but shows one picture.
    const pictures = new Set<string>()
    let running = 0
    for (let i = 0; i < 6; i++) {
      running += await app.run(500)
      pictures.add(JSON.stringify(app.captureSpans().lines))
    }
    expect([running, tickers(), pictures.size > 1]).toEqual([frames, open, true])
    app.setVisible(false)
    await app.run(100)
    expect(await app.run(1000)).toBe(hidden)
    app.setVisible(true)
    await app.run(1000)
    app.setShown(false)
    expect([await app.run(1000), tickers(), app.clock.pendingTimerCount]).toEqual([1, 0, 0])
  })
}

test("a shimmer spinner steps its glyph by the tick count", async () => {
  await using app = await mount(() => <Spinner shimmer={SHIMMER}>work</Spinner>)
  const glyph = () => SPINNER_FRAMES.indexOf(app.captureCharFrame().trim().split(" ")[0]!)
  await app.run(80)
  const first = glyph()
  // One late frame covers three due ticks.
  app.clock.advance(240)
  await app.renderOnce()
  expect((glyph() - first + SPINNER_FRAMES.length) % SPINNER_FRAMES.length).toBe(3)
})

// Steps are tick counts: one late frame lands on the same cell as steady frames. SEED_WORK's 32 ms step is exact in
// floating point, so the two paths cannot differ by rounding.
test("a one-cell spinner keeps up with the clock across a late frame", async () => {
  const cells = async (late: boolean) => {
    await using app = await mount(() => <OneCellSpinner animation={SEED_WORK} color="#ffffff" />)
    const out: string[] = []
    for (let i = 0; i < 6; i++) {
      if (late) (app.clock.advance(400), await app.renderOnce(), await app.renderer.idle())
      else await app.run(400)
      await app.renderOnce()
      out.push(JSON.stringify(app.captureSpans().lines[0]!.spans[0]))
    }
    return out
  }
  const steady = await cells(false)
  expect(new Set(steady).size).toBeGreaterThan(1)
  expect(await cells(true)).toEqual(steady)
})

test("a title shimmer stops ticking once its rename settles", async () => {
  using tickers = countTickers()
  const [title, setTitle] = createSignal("Untitled session")
  const [pending, setPending] = createSignal(true)
  await using app = await mount(() => (
    <title_shimmer content={title()} rename={{ title: title(), pending: pending() }} />
  ))
  await app.run(500)
  expect(tickers()).toBe(1)
  setTitle("Generated title")
  setPending(false)
  await app.run(2000)
  expect([await app.run(1000), tickers(), app.clock.pendingTimerCount, app.captureCharFrame().trim()]).toEqual([
    0,
    0,
    0,
    "Generated title",
  ])
})

function TwoTweens() {
  const short = createAnimatable({ x: 0 }, { transition: tween({ duration: 0.2 }) })
  const long = createAnimatable({ x: 0 }, { transition: tween({ duration: 0.3 }) })
  short.animate({ x: 1 })
  long.animate({ x: 1 })
  return (
    <text>
      {short.value().x.toFixed(2)} {long.value().x.toFixed(2)}
    </text>
  )
}

test("tweens share one subscription, both finish, and it ends with the last", async () => {
  using tickers = countTickers()
  await using app = await mount(() => <TwoTweens />)
  const open = tickers()
  await app.run(250)
  const between = [tickers(), app.captureCharFrame().trim().split(" ")[0]]
  await app.run(750)
  expect([open, between, await app.run(1000), tickers(), app.clock.pendingTimerCount]).toEqual([
    1,
    [1, "1.00"],
    0,
    0,
    0,
  ])
  expect(app.captureCharFrame().trim()).toBe("1.00 1.00")
})

// The 200 ms sweep waits while hidden, runs once shown, then stops.
test("fade-in text sweeps at 60 fps only while drawn, then idles", async () => {
  using tickers = countTickers()
  await using app = await mount(() => <FadeInText>hello</FadeInText>)
  app.setVisible(false)
  await app.run(100)
  expect(await app.run(1000)).toBe(0)
  app.setVisible(true)
  expect([await app.run(1000), await app.run(1000), tickers(), app.clock.pendingTimerCount]).toEqual([14, 0, 0, 0])
})
