/** @jsxImportSource @opentui/solid */
// P-ORACLE on frame sequences for U.6: renders the TUI's motion renderables under OpenTUI's manual clock and
// captures row 0 at fixed instants. Each fixture in parity/fixtures/U.6/ is a filmstrip: row N is the frame at
// the Nth instant listed in instants.json. crates/ui/tests/motion_frames.rs renders the Rust widgets in a TestApp,
// advances its clock to the same instants, and compares the stacked rows cell by cell.
//
// Instants of the stepped spinners are multiples of their interval: OpenTUI ticks a spinner on any frame within
// half an interval of a due time, Rust exactly at it (parity/deviations/T20-spinner-tick-phase.md).
import { RGBA, type OptimizedBuffer } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import "../../../tui/src/component/fade-in-text"
import { OneCellSpinner } from "../../../tui/src/component/one-cell-spinner"
import { ShimmerText } from "../../../tui/src/component/shimmer-text"
import { SPINNER_FRAMES } from "../../../tui/src/component/spinner-frames"
import "../../../tui/src/component/spinner-renderable"
import { WORK_SPINNERS } from "../../../tui/src/ui/one-cell-motion"
import { createColors, createFrames } from "../../../tui/src/ui/spinner"
import { readCells, writeFixture, type Fixture } from "../lib/cells"

const MUTED = "#808080"
const TEXT = "#eeeeee"
const BACKDROP = "#0a0a0a"
const ACCENT = "#fab283"
const range = (end: number, step: number) => Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step)

const scanner = { color: RGBA.fromHex(ACCENT), style: "blocks" as const, inactiveFactor: 0.6, minAlpha: 0.3 }

const cases: { name: string; width: number; instants: number[]; element: () => JSX.Element }[] = [
  {
    name: "spinner",
    width: 12,
    instants: range(880, 80),
    element: () => (
      <box flexDirection="row" gap={1}>
        <box flexShrink={0}>
          <spinner frames={SPINNER_FRAMES} interval={80} color={MUTED} />
        </box>
        <text fg={MUTED}>Working</text>
      </box>
    ),
  },
  {
    name: "scanner",
    width: 8,
    instants: range(56 * 40, 40),
    element: () => <spinner frames={createFrames(scanner)} color={createColors(scanner)} interval={40} />,
  },
  {
    name: "soft-slide",
    width: 1,
    instants: range(1100, 100),
    element: () => <OneCellSpinner animation={WORK_SPINNERS["block-soft-slide"]} color={ACCENT} />,
  },
  {
    name: "shimmer",
    width: 24,
    instants: range(1300, 50),
    element: () => (
      <ShimmerText fg={MUTED} shimmer={RGBA.fromHex(TEXT)}>
        Checking for updates…
      </ShimmerText>
    ),
  },
  {
    name: "fade",
    width: 16,
    instants: range(240, 20),
    element: () => (
      <box backgroundColor={BACKDROP}>
        <fade_in_text fg={MUTED} backdrop={RGBA.fromHex(BACKDROP)}>
          Welcome back
        </fade_in_text>
      </box>
    ),
  },
]

const instants: Record<string, number[]> = {}
for (const item of cases) {
  const clock = new ManualClock()
  const setup = await testRender(item.element, { width: item.width, height: 1, clock })
  try {
    const frames: Fixture[] = []
    for (const instant of item.instants) {
      clock.setTime(instant)
      await setup.renderOnce()
      frames.push(readCells(setup.renderer.currentRenderBuffer as OptimizedBuffer))
    }
    await writeFixture(path(item.name), stack(frames))
    instants[item.name] = item.instants
    console.log(`motion: U.6/${item.name} ${item.width}x${item.instants.length}`)
  } finally {
    setup.renderer.destroy()
  }
}
await Bun.write(path("instants"), JSON.stringify(instants, null, 2) + "\n")

function path(name: string) {
  return new URL(`../fixtures/U.6/${name}.json`, import.meta.url).pathname
}

// Row 0 of every frame, as one fixture whose styles are renumbered across frames.
function stack(frames: Fixture[]): Fixture {
  const styles: string[] = []
  const runs = frames.map((frame) =>
    frame.runs[0]!.map(([style, count]): [number, number] => {
      const key = frame.styles[style]!
      const index = styles.indexOf(key)
      return [index === -1 ? styles.push(key) - 1 : index, count]
    }),
  )
  return { width: frames[0]!.width, height: frames.length, rows: frames.map((frame) => frame.rows[0]!), styles, runs }
}
