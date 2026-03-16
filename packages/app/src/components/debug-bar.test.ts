import { describe, expect, test } from "bun:test"
import { hide } from "./debug-bar-state"

describe("debug bar env", () => {
  test("hides only for enabled flag values", () => {
    expect(hide(undefined)).toBe(false)
    expect(hide("")).toBe(false)
    expect(hide("0")).toBe(false)
    expect(hide("false")).toBe(false)
    expect(hide("1")).toBe(true)
    expect(hide("true")).toBe(true)
    expect(hide(" TRUE ")).toBe(true)
  })
})
