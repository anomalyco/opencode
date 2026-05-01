import { describe, expect, test } from "bun:test"
import { TIPS } from "../../../src/cli/cmd/tui/feature-plugins/home/tips-view"

describe("tui TIPS", () => {
  test("every tip fits within max visible length", () => {
    // see TIPS comment for 69 reference
    const tooLongTips = TIPS.filter((tip) => tip.replace(/\{\/?highlight\}/g, "").length > 69)
    expect(tooLongTips).toEqual([])
  })
})
