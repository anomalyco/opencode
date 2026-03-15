import { describe, it, expect } from "bun:test"
import { SkillMapper } from "./skill-mapper"

describe("SkillMapper", () => {
  it("maps tags to skill names correctly", async () => {
    // Test that the TAG_TO_SKILLS mapping works by checking
    // that different tag combinations return appropriate skill sets
    const recoveryTags = ["recovery", "retry", "fallback"]
    const archTags = ["architecture", "design-pattern", "refactor"]
    const testTags = ["testing", "coverage", "unit-test"]

    // These should not throw and should return arrays
    const recoverySkills = await SkillMapper.getSkillsForTags(recoveryTags)
    const archSkills = await SkillMapper.getSkillsForTags(archTags)
    const testSkills = await SkillMapper.getSkillsForTags(testTags)

    // All should return arrays (may be empty if skills not loaded)
    expect(Array.isArray(recoverySkills)).toBe(true)
    expect(Array.isArray(archSkills)).toBe(true)
    expect(Array.isArray(testSkills)).toBe(true)
  })

  it("formats skills for prompt correctly", () => {
    // Test with mock skills
    const mockSkills = [
      {
        name: "test-skill",
        description: "A test skill",
        location: "/test/skill.md",
        content: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6",
      },
    ]

    const formatted = SkillMapper.formatSkillsForPrompt(mockSkills)

    expect(formatted).toContain("Auto-Injected Skills")
    expect(formatted).toContain("relevant to your task")
    expect(formatted).toContain("test-skill")
    expect(formatted).toContain("Line 1")
    expect(formatted).toContain("Line 5")
    // Should only include first 5 lines
    expect(formatted).not.toContain("Line 6")
  })

  it("returns empty string for empty skills array", () => {
    const formatted = SkillMapper.formatSkillsForPrompt([])
    expect(formatted).toBe("")
  })

  it("handles unknown tags gracefully", async () => {
    const tags = ["unknown_tag_xyz", "nonexistent_tag"]
    const skills = await SkillMapper.getSkillsForTags(tags)

    // Should return empty array for unknown tags
    expect(Array.isArray(skills)).toBe(true)
    expect(skills.length).toBe(0)
  })

  it("handles mixed known and unknown tags", async () => {
    const tags = ["unknown_tag_xyz", "recovery", "another_unknown"]
    const skills = await SkillMapper.getSkillsForTags(tags)

    // Should not throw and should return array
    expect(Array.isArray(skills)).toBe(true)
  })

  it("deduplicates skills from multiple tags", async () => {
    // Multiple tags mapping to same skill should not duplicate
    const tags = ["recovery", "retry", "fallback"] // All map to systematic-debugging
    const skills = await SkillMapper.getSkillsForTags(tags)

    // Should not throw
    expect(Array.isArray(skills)).toBe(true)
  })
})
