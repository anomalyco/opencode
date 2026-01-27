import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Skill } from "../../src/skill"
import { SkillRegistry } from "../../src/skill/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

beforeEach(() => {
  SkillRegistry.clear()
})

test("loads skills from SkillRegistry", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, "plugin-skills", "pdf")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: pdf
description: Instructions for working with PDF files.
---

# PDF Skill

Instructions for PDF handling.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      SkillRegistry.register(path.join(tmp.path, "plugin-skills", "pdf"))
      const skills = await Skill.all()
      const pdfSkill = skills.find((s) => s.name === "pdf")
      expect(pdfSkill).toBeDefined()
      expect(pdfSkill!.description).toBe("Instructions for working with PDF files.")
    },
  })
})

test("project skills override plugin skills with same name", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const pluginSkillDir = path.join(dir, "plugin-skills", "pdf")
      await Bun.write(
        path.join(pluginSkillDir, "SKILL.md"),
        `---
name: pdf
description: Plugin PDF skill.
---
# Plugin PDF
`,
      )
      const projectSkillDir = path.join(dir, ".opencode", "skill", "pdf")
      await Bun.write(
        path.join(projectSkillDir, "SKILL.md"),
        `---
name: pdf
description: Project PDF skill (should win).
---
# Project PDF
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      SkillRegistry.register(path.join(tmp.path, "plugin-skills", "pdf"))
      const skills = await Skill.all()
      const pdfSkill = skills.find((s) => s.name === "pdf")
      expect(pdfSkill).toBeDefined()
      expect(pdfSkill!.description).toBe("Project PDF skill (should win).")
    },
  })
})

test("SkillRegistry stores and retrieves paths correctly", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(SkillRegistry.paths().length).toBe(0)
      SkillRegistry.register("/path/to/skill1")
      SkillRegistry.register("/path/to/skill2")
      expect(SkillRegistry.paths().length).toBe(2)
      expect(SkillRegistry.paths()).toContain("/path/to/skill1")
      expect(SkillRegistry.paths()).toContain("/path/to/skill2")
    },
  })
})

test("SkillRegistry.clear removes all paths", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      SkillRegistry.register("/path/to/skill1")
      SkillRegistry.register("/path/to/skill2")
      expect(SkillRegistry.paths().length).toBe(2)
      SkillRegistry.clear()
      expect(SkillRegistry.paths().length).toBe(0)
    },
  })
})
