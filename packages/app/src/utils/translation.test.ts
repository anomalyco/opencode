import { describe, expect, test } from "bun:test"
import { hasActiveTranslations } from "./translation"

describe("hasActiveTranslations", () => {
  test("returns true when any translation is queued or running", () => {
    expect(
      hasActiveTranslations([
        { translate_status: "idle" },
        { translate_status: "waiting" },
      ]),
    ).toBe(true)

    expect(hasActiveTranslations([{ translate_status: "started" }])).toBe(true)
  })

  test("returns false when translations are idle, finished, or missing", () => {
    expect(hasActiveTranslations()).toBe(false)
    expect(hasActiveTranslations([{ translate_status: "idle" }, { translate_status: "finished" }, {}])).toBe(false)
  })
})
