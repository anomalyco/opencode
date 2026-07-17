import { describe, expect, test } from "bun:test"
import { cruiseControlConclusion } from "../../src/util/cruise-control"

describe("cruiseControlConclusion", () => {
  test("formats structured reviewed assessment", () => {
    expect(
      cruiseControlConclusion({
        cruise_control: "legacy fallback",
        cruise_control_review: {
          risk: "high",
          intent: "low",
          reason: "Destructive action is not supported by the prompt.",
        },
      }),
    ).toBe("Risk: high · Intent: low — Destructive action is not supported by the prompt.")
  })

  test("uses explicit non-reviewed fallback without inventing levels", () => {
    expect(cruiseControlConclusion({ cruise_control: "Cached allow (no fresh model review)" })).toBe(
      "Cached allow (no fresh model review)",
    )
  })
})
