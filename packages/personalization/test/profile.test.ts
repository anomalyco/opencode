import { describe, expect, it } from "bun:test"
import { DEFAULT_USER_PROFILE, applyProfileDrift, formatProfileDirectives } from "../src/profile"

describe("Profile Module", () => {
  it("should have expected default user profile values", () => {
    expect(DEFAULT_USER_PROFILE.languages).toContain("typescript")
    expect(DEFAULT_USER_PROFILE.languages).toContain("python")
    expect(DEFAULT_USER_PROFILE.style.explicitness).toBeGreaterThan(0.5)
    expect(DEFAULT_USER_PROFILE.style.typing_rigor).toBeGreaterThan(0.8)
  })

  it("should apply dynamic profile drift using EMA", () => {
    const initial = { ...DEFAULT_USER_PROFILE }
    const updated = applyProfileDrift(
      initial,
      {
        style: {
          explicitness: 0.95,
          abstraction_tolerance: 0.1,
          verbosity: 0.2,
        },
        languages: ["rust", "go"],
      },
      0.5,
    )

    // Check EMA numeric update
    expect(updated.style.explicitness).toBeGreaterThanOrEqual(initial.style.explicitness)
    expect(updated.style.abstraction_tolerance).toBeLessThan(initial.style.abstraction_tolerance)
    expect(updated.style.verbosity).toBeLessThan(initial.style.verbosity)

    // Check language deduplication & insertion
    expect(updated.languages).toContain("rust")
    expect(updated.languages).toContain("go")
    expect(updated.languages).toContain("typescript")
  })

  it("should format high-signal profile directives", () => {
    const directives = formatProfileDirectives(DEFAULT_USER_PROFILE)
    expect(directives).toContain("Preferred Languages")
    expect(directives).toContain("Coding Style")
    expect(directives).toContain("explicit code")
  })
})
