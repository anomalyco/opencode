/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, type JSX } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { OneCellSpinner } from "../../src/component/one-cell-spinner"
import { Spinner, SPINNER_FRAMES } from "../../src/component/spinner"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { createAnimatable, tween } from "../../src/ui/animation"
import { BLOCK_LOW_COMET } from "../../src/ui/one-cell-motion"
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
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Show when={shown()}>{view()}</Show>
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
    async run(ms: number, settle = true) {
      frames = 0
      for (let elapsed = 5; elapsed <= ms; elapsed += 5) {
        clock.advance(5)
        if (settle) await app.renderer.idle()
        else await app.renderOnce()
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

// A view → frames over 3 s once it runs, with one subscription on the shared clock. Unmounted, it ticks no more.
const rows: [string, () => JSX.Element, number][] = [
  ["a spinner at 12.5 fps", () => <Spinner />, 38],
  ["a one-cell work spinner at 30 fps", () => <OneCellSpinner animation={BLOCK_LOW_COMET} color="#ffffff" />, 90],
  ["a 10 s tween at 60 fps", () => <Tween />, 180],
]

for (const [name, view, frames] of rows) {
  test(`animation ticks: ${name}, and nothing after unmount`, async () => {
    using tickers = countTickers()
    await using app = await mount(view)
    await app.run(1000)
    expect([await app.run(3000), tickers()]).toEqual([frames, 1])
    app.setShown(false)
    expect([await app.run(1000), tickers(), app.clock.pendingTimerCount]).toEqual([1, 0, 0])
  })
}

// The shimmer text itself is live, so this view never idles; the glyph still steps by the clock's tick count.
test("a shimmer spinner steps its glyph by ticks and stops ticking when unmounted", async () => {
  using tickers = countTickers()
  await using app = await mount(() => <Spinner shimmer={RGBA.fromHex("#ffffff")}>work</Spinner>)
  const glyph = () => SPINNER_FRAMES.indexOf(app.captureCharFrame().trim().split(" ")[0]!)
  await app.run(80, false)
  const first = glyph()
  // One late frame covers three due ticks.
  app.clock.advance(240)
  await app.renderOnce()
  expect([(glyph() - first + SPINNER_FRAMES.length) % SPINNER_FRAMES.length, tickers()]).toEqual([3, 1])
  app.setShown(false)
  await app.run(80, false)
  expect(tickers()).toBe(0)
})
