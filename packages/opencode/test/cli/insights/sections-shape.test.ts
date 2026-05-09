import { describe, expect, test } from "bun:test"
import { ProjectAreasSection, FrictionAnalysisSection } from "@/insights/schema"

describe("section schemas", () => {
  test("ProjectAreasSection round-trip", () => {
    const ok = ProjectAreasSection.safeParse({
      areas: [{ name: "Backend", session_count: 3, description: "Worked on the FastAPI auth flow" }],
    })
    expect(ok.success).toBe(true)
  })
  test("FrictionAnalysisSection requires examples", () => {
    const bad = FrictionAnalysisSection.safeParse({ intro: "x", categories: [{ category: "y", description: "z" }] })
    expect(bad.success).toBe(false)
  })
})
