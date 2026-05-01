import { describe, expect, test } from "bun:test"
import { leadingSkillCommandToken, type SkillCommandCandidate } from "./skill-token"

const commands: SkillCommandCandidate[] = [
  { name: "prompt", source: "skill" },
  { name: "summarize", source: "skill" },
  { name: "mcp-command", source: "mcp" },
  { name: "custom-command", source: "command" },
]

describe("leadingSkillCommandToken", () => {
  test("matches an exact leading skill command", () => {
    expect(leadingSkillCommandToken("/prompt", commands)).toEqual({
      name: "prompt",
      token: "/prompt",
      start: 0,
      end: 7,
    })
    expect(leadingSkillCommandToken("/summarize", commands)).toEqual({
      name: "summarize",
      token: "/summarize",
      start: 0,
      end: 10,
    })
  })

  test("matches only the leading skill token when arguments follow", () => {
    expect(leadingSkillCommandToken("/prompt do this", commands)?.token).toBe("/prompt")
    expect(leadingSkillCommandToken("/prompt\ndo this", commands)?.token).toBe("/prompt")
    expect(leadingSkillCommandToken("/summarize that", commands)?.token).toBe("/summarize")
    expect(leadingSkillCommandToken("/summarize\nthat", commands)?.token).toBe("/summarize")
  })

  test("does not match partial or unknown commands", () => {
    expect(leadingSkillCommandToken("/pro", commands)).toBeUndefined()
    expect(leadingSkillCommandToken("/unknown", commands)).toBeUndefined()
  })

  test("does not match non-skill slash commands", () => {
    expect(leadingSkillCommandToken("/mcp-command", commands)).toBeUndefined()
    expect(leadingSkillCommandToken("/custom-command", commands)).toBeUndefined()
    expect(leadingSkillCommandToken("/skills", [{ name: "skills", source: "command" }])).toBeUndefined()
  })

  test("non-skill command source suppresses same-name skill collision", () => {
    expect(
      leadingSkillCommandToken("/prompt", [
        { name: "prompt", source: "skill" },
        { name: "prompt", source: "command" },
      ]),
    ).toBeUndefined()
  })
})
