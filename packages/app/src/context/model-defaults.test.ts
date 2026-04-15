import { describe, expect, test } from "bun:test"
import { formatActiveModelLabel, PREFERRED_DEFAULT_MODEL } from "./model-defaults"

describe("model defaults", () => {
  test("prefers the OpenRouter Gemini 3 Flash Preview model", () => {
    expect(PREFERRED_DEFAULT_MODEL).toEqual({
      providerID: "openrouter",
      modelID: "google/gemini-3-flash-preview",
    })
  })

  test("formats the active model label for console logging", () => {
    expect(
      formatActiveModelLabel({
        name: "Gemini 3 Flash Preview",
        provider: { id: "openrouter" },
      }),
    ).toBe("openrouter / Gemini 3 Flash Preview")
  })
})
