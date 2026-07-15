import { describe, expect, test } from "bun:test"
import { incrementSkillUsage, rankSkills, sanitizeSkillUsage } from "../../src/feature-plugins/sidebar/skill-usage"

describe("skill usage", () => {
  test("ranks used skills by frecency before alphabetical unused skills", () => {
    const now = 10 * 86_400_000
    const result = rankSkills(
      ["zeta", "alpha", "recent", "frequent"],
      {
        recent: { count: 2, lastUsed: now },
        frequent: { count: 8, lastUsed: now - 7 * 86_400_000 },
      },
      now,
    )

    expect(result.map((item) => item.name)).toEqual(["recent", "frequent", "alpha", "zeta"])
  })

  test("uses last use and name to break equal score ties", () => {
    const now = 10 * 86_400_000
    const result = rankSkills(
      ["beta", "alpha", "older"],
      {
        alpha: { count: 1, lastUsed: now },
        beta: { count: 1, lastUsed: now },
        older: { count: 2, lastUsed: now - 86_400_000 },
      },
      now,
    )

    expect(result.map((item) => item.name)).toEqual(["alpha", "beta", "older"])
  })

  test("increments immutably and updates the timestamp", () => {
    const usage = { alpha: { count: 2, lastUsed: 10 } }
    const result = incrementSkillUsage(usage, "alpha", 20)

    expect(result).toEqual({ alpha: { count: 3, lastUsed: 20 } })
    expect(usage).toEqual({ alpha: { count: 2, lastUsed: 10 } })
  })

  test("sanitizes invalid records and clamps future timestamps", () => {
    const result = sanitizeSkillUsage(
      {
        valid: { count: 2, lastUsed: 50 },
        future: { count: 1, lastUsed: 200 },
        negative: { count: -1, lastUsed: 10 },
        fractional: { count: 1.5, lastUsed: 10 },
        malformed: "nope",
      },
      100,
    )

    expect(result).toEqual({
      valid: { count: 2, lastUsed: 50 },
      future: { count: 1, lastUsed: 100 },
    })
  })

  test("limits results and ignores usage for unregistered skills", () => {
    const names = Array.from({ length: 12 }, (_, index) => `skill-${index.toString().padStart(2, "0")}`)
    const result = rankSkills(names, { removed: { count: 100, lastUsed: 100 } }, 100)

    expect(result).toHaveLength(10)
    expect(result.map((item) => item.name)).toEqual(names.slice(0, 10))
  })
})
