import { test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"
import path from "path"
import fs from "fs/promises"

async function createGlobalSkill(homeDir: string) {
  const skillDir = path.join(homeDir, ".claude", "skills", "global-test-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-test-skill
description: A global skill from ~/.claude/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )
}

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
      const testSkill = skills.find((s) => s.name === "test-skill")
      expect(testSkill).toBeDefined()
      expect(testSkill!.description).toBe("A test skill for verification.")
      expect(testSkill!.location).toContain("skill/test-skill/SKILL.md")
    },
  })
})

test("returns skill directories from Skill.dirs", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "dir-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: dir-skill
description: Skill for dirs test.
---

# Dir Skill
`,
      )
    },
  })

  const home = process.env.OPENCODE_TEST_HOME
  process.env.OPENCODE_TEST_HOME = tmp.path

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dirs = await Skill.dirs()
        const skillDir = path.join(tmp.path, ".opencode", "skill", "dir-skill")
        expect(dirs).toContain(skillDir)
        expect(dirs.length).toBe(1)
      },
    })
  } finally {
    process.env.OPENCODE_TEST_HOME = home
  }
})

test("discovers multiple skills from .opencode/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir1 = path.join(dir, ".opencode", "skill", "skill-one")
      const skillDir2 = path.join(dir, ".opencode", "skill", "skill-two")
      await Bun.write(
        path.join(skillDir1, "SKILL.md"),
        `---
name: skill-one
description: First test skill.
---

# Skill One
`,
      )
      await Bun.write(
        path.join(skillDir2, "SKILL.md"),
        `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(2)
      expect(skills.find((s) => s.name === "skill-one")).toBeDefined()
      expect(skills.find((s) => s.name === "skill-two")).toBeDefined()
    },
  })
})

test("skips skills with missing frontmatter", async () => {
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
      const skills = await Skill.all()
      expect(skills).toEqual([])
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
      const claudeSkill = skills.find((s) => s.name === "claude-skill")
      expect(claudeSkill).toBeDefined()
      expect(claudeSkill!.location).toContain(".claude/skills/claude-skill/SKILL.md")
    },
  })
})

test("discovers global skills from ~/.claude/skills/ directory", async () => {
  await using tmp = await tmpdir({ git: true })

  const originalHome = process.env.OPENCODE_TEST_HOME
  process.env.OPENCODE_TEST_HOME = tmp.path

  try {
    await createGlobalSkill(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(skills.length).toBe(1)
        expect(skills[0].name).toBe("global-test-skill")
        expect(skills[0].description).toBe("A global skill from ~/.claude/skills for testing.")
        expect(skills[0].location).toContain(".claude/skills/global-test-skill/SKILL.md")
      },
    })
  } finally {
    process.env.OPENCODE_TEST_HOME = originalHome
  }
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

test("discovers skills from .agents/skills/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".agents", "skills", "agent-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(1)
      const agentSkill = skills.find((s) => s.name === "agent-skill")
      expect(agentSkill).toBeDefined()
      expect(agentSkill!.location).toContain(".agents/skills/agent-skill/SKILL.md")
    },
  })
})

test("discovers global skills from ~/.config/agents/skills/ directory (XDG-compliant)", async () => {
  await using tmp = await tmpdir({ git: true })

  const uniqueId = Math.random().toString(36).slice(2, 8)
  const skillName = `xdg-agent-skill-${uniqueId}`

  const skillDir = path.join(Global.Path.config, "agents", "skills", skillName)
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${skillName}
description: A global skill from ~/.config/agents/skills for testing.
---

# XDG Agent Skill
`,
  )

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        const foundSkill = skills.find((s) => s.name === skillName)
        expect(foundSkill).toBeDefined()
        expect(foundSkill!.description).toBe("A global skill from ~/.config/agents/skills for testing.")
        expect(foundSkill!.location).toContain("agents/skills/")
      },
    })
  } finally {
    await fs.rm(skillDir, { recursive: true, force: true })
  }
})

test("prioritizes ~/.config/agents/skills over ~/.agents/skills", async () => {
  await using tmp = await tmpdir({ git: true })

  // Use unique skill names to avoid conflicts with other tests
  const uniqueId = Math.random().toString(36).slice(2, 8)
  const skillName = `priority-skill-${uniqueId}`

  // Create XDG skill in global config location (higher priority)
  const xdgSkillDir = path.join(Global.Path.config, "agents", "skills", skillName)
  await fs.mkdir(xdgSkillDir, { recursive: true })
  await Bun.write(
    path.join(xdgSkillDir, "SKILL.md"),
    `---
name: ${skillName}
description: XDG-compliant skill from ~/.config/agents/skills.
---

# Priority Skill (XDG)
`,
  )

  // Create legacy skill in home directory (lower priority)
  const legacySkillDir = path.join(Global.Path.home, ".agents", "skills", skillName)
  await fs.mkdir(legacySkillDir, { recursive: true })
  await Bun.write(
    path.join(legacySkillDir, "SKILL.md"),
    `---
name: ${skillName}
description: Legacy skill from ~/.agents/skills.
---

# Priority Skill (Legacy)
`,
  )

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        const prioritySkill = skills.find((s) => s.name === skillName)
        expect(prioritySkill).toBeDefined()
        expect(prioritySkill!.description).toBe("XDG-compliant skill from ~/.config/agents/skills.")
        expect(prioritySkill!.location).toContain("agents/skills/")
      },
    })
  } finally {
    await fs.rm(xdgSkillDir, { recursive: true, force: true })
    await fs.rm(legacySkillDir, { recursive: true, force: true })
  }
})

test("discovers global skills from ~/.agents/skills/ directory", async () => {
  await using tmp = await tmpdir({ git: true })

  const uniqueId = Math.random().toString(36).slice(2, 8)
  const skillName = `global-agent-skill-${uniqueId}`

  const skillDir = path.join(Global.Path.home, ".agents", "skills", skillName)
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${skillName}
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill
`,
  )

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        const foundSkill = skills.find((s) => s.name === skillName)
        expect(foundSkill).toBeDefined()
        expect(foundSkill!.description).toBe("A global skill from ~/.agents/skills for testing.")
        expect(foundSkill!.location).toContain(".agents/skills/")
      },
    })
  } finally {
    await fs.rm(skillDir, { recursive: true, force: true })
  }
})

test("discovers skills from both .claude/skills/ and .agents/skills/", async () => {
  const uniqueId = Math.random().toString(36).slice(2, 8)

  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const claudeDir = path.join(dir, ".claude", "skills", `claude-skill-${uniqueId}`)
      const agentDir = path.join(dir, ".agents", "skills", `agent-skill-${uniqueId}`)
      await Bun.write(
        path.join(claudeDir, "SKILL.md"),
        `---
name: claude-skill-${uniqueId}
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
      await Bun.write(
        path.join(agentDir, "SKILL.md"),
        `---
name: agent-skill-${uniqueId}
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.find((s) => s.name === `claude-skill-${uniqueId}`)).toBeDefined()
      expect(skills.find((s) => s.name === `agent-skill-${uniqueId}`)).toBeDefined()
    },
  })
})

test("properly resolves directories that skills live in", async () => {
  const uniqueId = Math.random().toString(36).slice(2, 8)

  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const opencodeSkillDir = path.join(dir, ".opencode", "skill", `opencode-skill-${uniqueId}`)
      const opencodeSkillsDir = path.join(dir, ".opencode", "skills", `opencode-skills-${uniqueId}`)
      const claudeDir = path.join(dir, ".claude", "skills", `claude-skill-${uniqueId}`)
      const agentDir = path.join(dir, ".agents", "skills", `agent-skill-${uniqueId}`)
      await Bun.write(
        path.join(claudeDir, "SKILL.md"),
        `---
name: claude-skill-${uniqueId}
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
      await Bun.write(
        path.join(agentDir, "SKILL.md"),
        `---
name: agent-skill-${uniqueId}
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
      await Bun.write(
        path.join(opencodeSkillDir, "SKILL.md"),
        `---
name: opencode-skill-${uniqueId}
description: A skill in the .opencode/skill directory.
---

# OpenCode Skill
`,
      )
      await Bun.write(
        path.join(opencodeSkillsDir, "SKILL.md"),
        `---
name: opencode-skills-${uniqueId}
description: A skill in the .opencode/skills directory.
---

# OpenCode Skills
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Skill.dirs()
      const skillNames = [
        `claude-skill-${uniqueId}`,
        `agent-skill-${uniqueId}`,
        `opencode-skill-${uniqueId}`,
        `opencode-skills-${uniqueId}`,
      ]
      for (const name of skillNames) {
        expect(dirs.some((d) => d.includes(name))).toBe(true)
      }
    },
  })
})
