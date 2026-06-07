import { expect, test } from "bun:test"
import { createRenderer, createTuiRenderer, mount, run, tui } from "../src"

test("exports the canonical application lifecycle", () => {
  expect(run).toBe(tui)
  expect(createRenderer).toBe(createTuiRenderer)
  expect(typeof mount).toBe("function")
})
