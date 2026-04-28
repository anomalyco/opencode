import { describe, expect, test } from "bun:test"
import { shouldUseSoftIcon } from "./icon-soft"

describe("Icon preset", () => {
  test("uses soft icon when mapped", () => {
    expect(shouldUseSoftIcon("soft", "menu")).toBeTrue()
  })

  test("falls back to sharp when soft icon is missing", () => {
    expect(shouldUseSoftIcon("soft", "bubble-5")).toBeFalse()
  })
})
