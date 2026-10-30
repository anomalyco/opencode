/** @jsxImportSource @opentui/solid */
import { afterEach, expect, jest, setSystemTime, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createMemo, createRoot } from "solid-js"
import { formatToolTimestamp, InlineToolRow } from "../../src/routes/session"
import { localDay } from "../../src/util/day"
import { Locale } from "../../src/util/locale"

const format = { date: "YYYY-MM-DD", time: "HH:mm:ss" }
const end = new Date(2026, 9, 11, 22, 1, 28).getTime()
const state = {
  status: "completed" as const,
  input: {},
  output: "",
  title: "",
  metadata: {},
  time: { start: end - 464, end },
}
let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
  localDay.stop()
  jest.useRealTimers()
  setSystemTime()
})

async function frame() {
  await setup!.renderOnce()
  return setup!.captureCharFrame()
}

test("a footer rendered before midnight shows the date once the day changes, with no other trigger", async () => {
  localDay.stop()
  jest.useFakeTimers()
  setSystemTime(new Date(2026, 9, 11, 23, 59, 58))
  setup = await testRender(
    () => (
      <InlineToolRow
        icon="⚙"
        complete={true}
        pending=""
        timestamp={formatToolTimestamp(state, { time: true, duration: true, format })}
      >
        vtps
      </InlineToolRow>
    ),
    { width: 60, height: 2 },
  )
  expect(await frame()).toContain("⚙ vtps · 22:01:28 · 464ms")
  jest.advanceTimersByTime(3_000)
  expect(await frame()).toContain("⚙ vtps · 2026-10-11 22:01:28 · 464ms")
})

test("every reader shares one day timer, re-armed after each firing", () => {
  localDay.stop()
  jest.useFakeTimers()
  setSystemTime(new Date(2026, 9, 11, 23, 0, 0))
  const before = jest.getTimerCount()
  const runs: number[] = []
  const dispose = createRoot((dispose) => {
    for (const index of Array.from({ length: 30 }, (_, index) => index))
      createMemo(() => {
        runs[index] = (runs[index] ?? 0) + 1
        return Locale.todayTimeOrDateFirst(end, format)
      })
    return dispose
  })
  expect(jest.getTimerCount() - before).toBe(1)
  jest.advanceTimersByTime(3_600_000)
  expect(jest.getTimerCount() - before).toBe(1)
  jest.advanceTimersByTime(3_600_000)
  expect(jest.getTimerCount() - before).toBe(1)
  expect(runs).toEqual(Array.from({ length: 30 }, () => 2))
  dispose()
})
