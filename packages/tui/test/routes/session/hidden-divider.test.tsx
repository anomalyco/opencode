/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { TuiConfigProvider } from "../../../src/config"
import { KVProvider } from "../../../src/context/kv"
import type { HiddenEdge, HiddenMessages } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { HiddenMessagesDivider, loadAllNote } from "../../../src/routes/session/hidden-divider"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

async function frame(root: string, count: number, width: number, loading?: HiddenMessages["loading"]) {
  const state = path.join(root, `state-${count}-${width}-${loading?.edge ?? "idle"}`)
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const loads: { edge: HiddenEdge; size?: number }[] = []
  const [hidden] = createSignal<HiddenMessages>({ head: 1, count, limit: 100, loading })
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <HiddenMessagesDivider
                hidden={hidden()}
                width={width}
                first
                onLoad={(edge, size) => loads.push({ edge, size })}
              />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 8 },
  )
  const lines = () =>
    app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
  const start = Date.now()
  while (!app.captureCharFrame().includes("hidden")) {
    if (Date.now() - start > 2000) throw new Error("divider never rendered")
    await app.renderOnce()
    await Bun.sleep(10)
  }
  return { app, lines: lines(), loads }
}

test("160 columns: page rows around a rule carrying the count and load all", async () => {
  await using tmp = await tmpdir()
  const view = await frame(tmp.path, 3250, 160)
  try {
    expect(view.lines).toEqual([
      " ".repeat(65) + "load 50 above   load 100 above",
      "─".repeat(52) + " 3,250 messages hidden:  load all (slow / memory heavy) " + "─".repeat(52),
      " ".repeat(65) + "load 50 below   load 100 below",
    ])
  } finally {
    view.app.renderer.destroy()
  }
})

test("80 columns: the same three rows, a shorter rule", async () => {
  await using tmp = await tmpdir()
  const view = await frame(tmp.path, 3250, 80)
  try {
    expect(view.lines).toEqual([
      " ".repeat(25) + "load 50 above   load 100 above",
      "─".repeat(12) + " 3,250 messages hidden:  load all (slow / memory heavy) " + "─".repeat(12),
      " ".repeat(25) + "load 50 below   load 100 below",
    ])
  } finally {
    view.app.renderer.destroy()
  }
})

test("40 columns: load all moves under a rule that keeps only the count", async () => {
  await using tmp = await tmpdir()
  const view = await frame(tmp.path, 3250, 40)
  try {
    expect(view.lines).toEqual([
      "     load 50 above   load 100 above",
      "─".repeat(13) + " 3,250 hidden " + "─".repeat(13),
      "     load all (slow / memory heavy)",
      "     load 50 below   load 100 below",
    ])
  } finally {
    view.app.renderer.destroy()
  }
})

test("a gap of 51 to 100 offers only the 50 page, a gap of 50 or fewer only load all", async () => {
  await using tmp = await tmpdir()
  const mid = await frame(tmp.path, 75, 80)
  try {
    expect(mid.lines).toEqual([
      " ".repeat(33) + "load 50 above",
      "─".repeat(24) + " 75 messages hidden:  load all " + "─".repeat(25),
      " ".repeat(33) + "load 50 below",
    ])
  } finally {
    mid.app.renderer.destroy()
  }
  const small = await frame(tmp.path, 1, 80)
  try {
    expect(small.lines).toEqual(["─".repeat(25) + " 1 message hidden:  load all " + "─".repeat(26)])
  } finally {
    small.app.renderer.destroy()
  }
})

test("load all warns from 300 hidden messages and adds memory heavy from 500", () => {
  expect(loadAllNote(299)).toBe("")
  expect(loadAllNote(300)).toBe(" (slow)")
  expect(loadAllNote(499)).toBe(" (slow)")
  expect(loadAllNote(500)).toBe(" (slow / memory heavy)")
})

test("clicks load the page they name; a load in flight shows loading… and ignores clicks", async () => {
  await using tmp = await tmpdir()
  const view = await frame(tmp.path, 3250, 80)
  try {
    const click = async (row: number, label: string) => {
      const col = view.lines[row].indexOf(label) + 1
      await view.app.mockMouse.click(col, row)
    }
    await click(0, "load 100 above")
    await click(2, "load 50 below")
    await click(1, "load all")
    expect(view.loads).toEqual([
      { edge: "above", size: 100 },
      { edge: "below", size: 50 },
      { edge: "all", size: undefined },
    ])
  } finally {
    view.app.renderer.destroy()
  }
  const busy = await frame(tmp.path, 3250, 80, { edge: "below", size: 100 })
  try {
    expect(busy.lines[2].trim()).toBe("load 50 below   loading…")
    await busy.app.mockMouse.click(busy.lines[0].indexOf("load 50 above") + 1, 0)
    expect(busy.loads).toEqual([])
  } finally {
    busy.app.renderer.destroy()
  }
})
