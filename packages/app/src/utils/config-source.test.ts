import { describe, expect, test } from "bun:test"
import type { Project } from "@opencode-ai/sdk/v2/client"
import { classifyPluginSource, classifySkillSource, isFilePath } from "./config-source"

describe("config source classification", () => {
  const projects = [
    {
      id: "p1",
      name: "Math and Physics",
      worktree: "/Users/me/math-physics",
      sandboxes: ["/Users/me/math-physics-sandbox"],
    },
  ] as Project[]

  test("classifies .opencode project plugins with project display name", () => {
    expect(classifyPluginSource("file:///Users/me/math-physics/.opencode/plugins/foo.ts", projects)).toMatchObject({
      scope: "project",
      group: "project",
      project: "Math and Physics",
      root: "/Users/me/math-physics",
      origin: ".opencode",
    })
  })

  test("classifies .agents project plugins", () => {
    expect(classifyPluginSource("file:///Users/me/math-physics/.agents/plugins/foo.ts", projects)).toMatchObject({
      scope: "project",
      group: "project",
      project: "Math and Physics",
      root: "/Users/me/math-physics",
      origin: ".agents",
    })
  })

  test("falls back to path-derived project for unloaded project plugins", () => {
    expect(classifyPluginSource("file:///Users/me/other/.agents/plugins/foo.ts", projects)).toMatchObject({
      scope: "project",
      group: "project",
      project: "other",
      root: "/Users/me/other",
      origin: ".agents",
    })
  })

  test("classifies project skills across supported origins", () => {
    expect(classifySkillSource("file:///Users/me/math-physics/.claude/skills/review/SKILL.md", projects)).toMatchObject({
      scope: "project",
      group: "project",
      project: "Math and Physics",
      root: "/Users/me/math-physics",
      origin: ".claude",
    })
    expect(classifySkillSource("file:///Users/me/math-physics/.agents/skills/review/SKILL.md", projects)).toMatchObject({
      scope: "project",
      group: "project",
      project: "Math and Physics",
      root: "/Users/me/math-physics",
      origin: ".agents",
    })
    expect(classifySkillSource("file:///Users/me/math-physics/.opencode/skills/review/SKILL.md", projects)).toMatchObject({
      scope: "project",
      group: "project",
      project: "Math and Physics",
      root: "/Users/me/math-physics",
      origin: ".opencode",
    })
  })

  test("detects local absolute file paths", () => {
    expect(isFilePath("/Users/me/project")).toBe(true)
    expect(isFilePath("C:\\Users\\me\\project")).toBe(true)
    expect(isFilePath("relative/project")).toBe(false)
    expect(isFilePath("")).toBe(false)
  })
})
