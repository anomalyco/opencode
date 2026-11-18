import { expect, test } from "bun:test"
import { createMemo, createRoot, createSignal } from "solid-js"

test("unit conditions resolve the reactive client build of solid-js", () => {
  expect(import.meta.resolve("solid-js")).toContain("/dist/solid.js")

  createRoot((dispose) => {
    const [n, setN] = createSignal(1)
    const double = createMemo(() => n() * 2)

    expect(double()).toBe(2)
    setN(2)
    expect(double()).toBe(4)
    dispose()
  })
})
