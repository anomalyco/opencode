import path from "path"
import { describe, expect, test } from "bun:test"
import { skillSource } from "../../src/component/dialog-skill"

const directory = path.resolve("/home/user/project")

describe("skill source", () => {
  test("classifies the built-in skill", () => {
    expect(skillSource("<built-in>", directory)).toBe("Built-in")
  })

  test("classifies skills inside the project as Project", () => {
    expect(skillSource(path.join(directory, ".opencode", "skill", "deploy", "SKILL.md"), directory)).toBe("Project")
  })

  test("classifies the project directory itself as Project", () => {
    expect(skillSource(directory, directory)).toBe("Project")
  })

  test("classifies skills outside the project as Global", () => {
    expect(skillSource(path.resolve("/home/user/.config/opencode/skill/review/SKILL.md"), directory)).toBe("Global")
  })

  test("does not treat sibling directories with a shared prefix as Project", () => {
    expect(skillSource(path.resolve("/home/user/project-other/skill/SKILL.md"), directory)).toBe("Global")
  })
})
