import { describe, expect, test } from "bun:test"
import { PREVIEW_URL } from "./preview-panel-helpers"

describe("PREVIEW_URL", () => {
  test("points to the laterdev preview endpoint", () => {
    expect(PREVIEW_URL).toBe("https://vibe.laterdev.com/preview")
  })
})
