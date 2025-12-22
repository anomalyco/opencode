import { test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

test("discovers skills from .opencode/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "test-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(1)
      expect(skills[0].name).toBe("test-skill")
      expect(skills[0].description).toBe("A test skill for verification.")
      expect(skills[0].location).toContain("skill/test-skill/SKILL.md")
    },
  })
})

test("discovers multiple skills from .opencode/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "my-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: my-skill
description: Another test skill.
---

# My Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(1)
      expect(skills[0].name).toBe("my-skill")
    },
  })
})

test("throws error for invalid skill name format", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "InvalidName")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: InvalidName
description: A skill with invalid name.
---
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Skill.all()).rejects.toThrow()
    },
  })
})

test("throws error when name doesn't match directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "dir-name")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: different-name
description: A skill with mismatched name.
---
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Skill.all()).rejects.toThrow("SkillNameMismatchError")
    },
  })
})

test("throws error for missing frontmatter", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "no-frontmatter")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `# No Frontmatter

Just some content without YAML frontmatter.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Skill.all()).rejects.toThrow("SkillInvalidError")
    },
  })
})

test("parses optional fields", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "full-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: full-skill
description: A skill with all optional fields.
license: MIT
compatibility: Requires Node.js 18+
metadata:
  author: test-author
  version: "1.0"
---

# Full Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(1)
      expect(skills[0].license).toBe("MIT")
      expect(skills[0].compatibility).toBe("Requires Node.js 18+")
      expect(skills[0].metadata).toEqual({
        author: "test-author",
        version: "1.0",
      })
    },
  })
})

test("ignores unknown frontmatter fields", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "extra-fields")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: extra-fields
description: A skill with extra unknown fields.
allowed-tools: Bash Read Write
some-other-field: ignored
---

# Extra Fields Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(1)
      expect(skills[0].name).toBe("extra-fields")
    },
  })
})

test("returns empty array when no skills exist", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills).toEqual([])
    },
  })
})

test("SystemPrompt.skills() returns empty array when no skills", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await SystemPrompt.skills()
      expect(result).toEqual([])
    },
  })
})

test("SystemPrompt.skills() returns XML block with skills", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "example-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: example-skill
description: An example skill for testing XML output.
---

# Example
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await SystemPrompt.skills()
      expect(result.length).toBe(1)
      expect(result[0]).toContain("<available_skills>")
      expect(result[0]).toContain("<name>example-skill</name>")
      expect(result[0]).toContain("<description>An example skill for testing XML output.</description>")
      expect(result[0]).toContain("SKILL.md</location>")
      expect(result[0]).toContain("</available_skills>")
      expect(result[0]).toContain("When a task matches a skill's description")
    },
  })
})

test("discovers skills from .claude/skills/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".claude", "skills", "claude-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(1)
      expect(skills[0].name).toBe("claude-skill")
      expect(skills[0].location).toContain(".claude/skills/claude-skill/SKILL.md")
    },
  })
})

test("Skill.filter() with undefined returns all skills", async () => {
  const skills = [
    { name: "git-commit", description: "Git commit", location: "/path" },
    { name: "git-push", description: "Git push", location: "/path" },
    { name: "code-review", description: "Code review", location: "/path" },
  ] as Skill.Info[]

  const result = Skill.filter(skills, undefined)
  expect(result).toEqual(skills)
})

test("Skill.filter() with empty object returns all skills", async () => {
  const skills = [
    { name: "git-commit", description: "Git commit", location: "/path" },
    { name: "git-push", description: "Git push", location: "/path" },
  ] as Skill.Info[]

  const result = Skill.filter(skills, {})
  expect(result).toEqual(skills)
})

test("Skill.filter() excludes skills with false values (blacklist mode)", async () => {
  const skills = [
    { name: "git-commit", description: "Git commit", location: "/path" },
    { name: "git-push", description: "Git push", location: "/path" },
    { name: "code-review", description: "Code review", location: "/path" },
  ] as Skill.Info[]

  const result = Skill.filter(skills, { "git-push": false })
  expect(result.length).toBe(2)
  expect(result.map((s) => s.name)).toEqual(["git-commit", "code-review"])
})

test("Skill.filter() supports wildcard patterns in blacklist mode", async () => {
  const skills = [
    { name: "git-commit", description: "Git commit", location: "/path" },
    { name: "git-push", description: "Git push", location: "/path" },
    { name: "code-review", description: "Code review", location: "/path" },
  ] as Skill.Info[]

  const result = Skill.filter(skills, { "git-*": false })
  expect(result.length).toBe(1)
  expect(result[0].name).toBe("code-review")
})

test("Skill.filter() with true values operates in whitelist mode", async () => {
  const skills = [
    { name: "git-commit", description: "Git commit", location: "/path" },
    { name: "git-push", description: "Git push", location: "/path" },
    { name: "code-review", description: "Code review", location: "/path" },
  ] as Skill.Info[]

  // Only spreadsheets: true means ONLY show skills matching true patterns
  const result = Skill.filter(skills, { "git-commit": true })
  expect(result.length).toBe(1)
  expect(result[0].name).toBe("git-commit")
})

test("SystemPrompt.skills() filters skills when agent pattern provided", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir1 = path.join(dir, ".opencode", "skill", "git-commit")
      await Bun.write(
        path.join(skillDir1, "SKILL.md"),
        `---
name: git-commit
description: Git commit helper.
---
`,
      )
      const skillDir2 = path.join(dir, ".opencode", "skill", "code-review")
      await Bun.write(
        path.join(skillDir2, "SKILL.md"),
        `---
name: code-review
description: Code review helper.
---
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Without filter
      const allResult = await SystemPrompt.skills()
      expect(allResult[0]).toContain("git-commit")
      expect(allResult[0]).toContain("code-review")

      // With filter excluding git-*
      const filteredResult = await SystemPrompt.skills({ "git-*": false })
      expect(filteredResult[0]).not.toContain("git-commit")
      expect(filteredResult[0]).toContain("code-review")
    },
  })
})
