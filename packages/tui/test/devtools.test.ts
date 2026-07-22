import { expect, test } from "bun:test"
import { DevTools } from "../src/devtools"
import { brailleGraph, connectionIndicator, runtimeStatus, statusIcon } from "../src/component/devtools-bar"

test("registers and updates grouped DevTools data", () => {
  const group = DevTools.register({ id: "test", title: "Test data" })

  group.set("Duration", "1.00 ms")
  group.set("Duration", "2.00 ms")
  group.set("Count", 2)

  expect(DevTools.data().find((item) => item.id === "test")).toEqual({
    id: "test",
    title: "Test data",
    entries: [
      { key: "Duration", value: "2.00 ms" },
      { key: "Count", value: 2 },
    ],
  })
})

test("renders fixed-width Braille process graphs", () => {
  const graph = brailleGraph([0, 25, 50, 75, 100], 4)

  expect(Array.from(graph)).toHaveLength(4)
  expect(Array.from(graph).every((character) => (character.codePointAt(0) ?? 0) >= 0x2800)).toBe(true)
  expect(brailleGraph([0], 4)).toBe("⣀⣀⣀⣀")
  expect(Array.from(brailleGraph([], 4))).toEqual(["⠀", "⠀", "⠀", "⠀"])
})

test("classifies the latest six seconds of event loop delay", () => {
  const samples = (delay: number, interval: number) =>
    Array.from({ length: Math.ceil(10_000 / interval) }, (_, index) => ({
      delay,
      time: index * interval,
    }))

  for (const interval of [250, 1_000, 2_000]) {
    expect(runtimeStatus(samples(19.9, interval))).toBe("normal")
    expect(runtimeStatus(samples(20, interval))).toBe("medium")
    expect(runtimeStatus(samples(99.9, interval))).toBe("medium")
    expect(runtimeStatus(samples(100, interval))).toBe("high")
  }
})

test("renders progressively filled status icons", () => {
  expect(statusIcon("normal")).toBe("○")
  expect(statusIcon("medium")).toBe("⦿")
  expect(statusIcon("high")).toBe("●")
})

test("renders distinct server connection indicators", () => {
  expect(connectionIndicator("connected", 0)).toEqual({ state: "connected", icon: "✓" })
  expect(connectionIndicator("connecting", 0)).toEqual({ state: "reconnecting", icon: "↻" })
  expect(connectionIndicator("reconnecting", 2)).toEqual({ state: "reconnecting", icon: "↻" })
  expect(connectionIndicator("reconnecting", 3)).toEqual({ state: "disconnected", icon: "×" })
})
