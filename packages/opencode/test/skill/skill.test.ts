import { test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
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

test("discovers global skills from ~/.agents/skills/ directory", async () => {
  await using tmp = await tmpdir({ git: true })

  const originalHome = process.env.OPENCODE_TEST_HOME
  process.env.OPENCODE_TEST_HOME = tmp.path

  try {
    const skillDir = path.join(tmp.path, ".agents", "skills", "global-agent-skill")
    await fs.mkdir(skillDir, { recursive: true })
    await Bun.write(
      path.join(skillDir, "SKILL.md"),
      `---
name: global-agent-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill

This skill is loaded from the global home directory.
`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(skills.length).toBe(1)
        expect(skills[0].name).toBe("global-agent-skill")
        expect(skills[0].description).toBe("A global skill from ~/.agents/skills for testing.")
        expect(skills[0].location).toContain(".agents/skills/global-agent-skill/SKILL.md")
      },
    })
  } finally {
    process.env.OPENCODE_TEST_HOME = originalHome
  }
})

test("discovers skills from both .claude/skills/ and .agents/skills/", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const claudeDir = path.join(dir, ".claude", "skills", "claude-skill")
      const agentDir = path.join(dir, ".agents", "skills", "agent-skill")
      await Bun.write(
        path.join(claudeDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
      await Bun.write(
        path.join(agentDir, "SKILL.md"),
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
      expect(skills.length).toBe(2)
      expect(skills.find((s) => s.name === "claude-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "agent-skill")).toBeDefined()
    },
  })
})

test("properly resolves directories that skills live in", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const opencodeSkillDir = path.join(dir, ".opencode", "skill", "agent-skill")
      const opencodeSkillsDir = path.join(dir, ".opencode", "skills", "agent-skill")
      const claudeDir = path.join(dir, ".claude", "skills", "claude-skill")
      const agentDir = path.join(dir, ".agents", "skills", "agent-skill")
      await Bun.write(
        path.join(claudeDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
      await Bun.write(
        path.join(agentDir, "SKILL.md"),
        `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )
      await Bun.write(
        path.join(opencodeSkillDir, "SKILL.md"),
        `---
name: opencode-skill
description: A skill in the .opencode/skill directory.
---

# OpenCode Skill
`,
      )
      await Bun.write(
        path.join(opencodeSkillsDir, "SKILL.md"),
        `---
name: opencode-skill
description: A skill in the .opencode/skills directory.
---

# OpenCode Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Skill.dirs()
      expect(dirs.length).toBe(4)
    },
  })
})

test("executes shell commands in skill content with !`command` syntax", async () => {
  const originalLine = 'The answer is: [!`echo "forty-two"`]'
  const renderedLine = "The answer is: [forty-two\n]"

  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "dynamic-skill")
      const skillContent = [
        "---",
        "name: dynamic-skill",
        "description: A skill with dynamic content.",
        "---",
        "",
        "# Dynamic Skill",
        "",
        originalLine,
        "",
        "That's it.",
      ].join("\n")
      await Bun.write(path.join(skillDir, "SKILL.md"), skillContent)
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { SkillTool } = await import("../../src/tool/skill")
      const skillTool = await SkillTool.init()
      const ctx = {
        sessionID: "test",
        messageID: "",
        callID: "",
        agent: "coder",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }

      const result = await skillTool.execute({ name: "dynamic-skill" }, ctx)

      expect(result.output).not.toContain(originalLine)
      expect(result.output).toContain(renderedLine)
    },
  })
})

test("handles multiple shell commands in a single skill", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "multi-cmd-skill")
      const skillContent = [
        "---",
        "name: multi-cmd-skill",
        "description: A skill with multiple dynamic commands.",
        "---",
        "",
        "# Multi Command Skill",
        "",
        'First value: [!`echo "one"`]',
        "",
        'Second value: [!`echo "two"`]',
        "",
        'Third value: [!`echo "three"`]',
      ].join("\n")
      await Bun.write(path.join(skillDir, "SKILL.md"), skillContent)
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { SkillTool } = await import("../../src/tool/skill")
      const skillTool = await SkillTool.init()
      const ctx = {
        sessionID: "test",
        messageID: "",
        callID: "",
        agent: "coder",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }

      const result = await skillTool.execute({ name: "multi-cmd-skill" }, ctx)

      expect(result.output).toContain("First value: [one\n]")
      expect(result.output).toContain("Second value: [two\n]")
      expect(result.output).toContain("Third value: [three\n]")
      expect(result.output).not.toContain("!`echo")
    },
  })
})

test("executes shell commands in the project directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "cwd-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: cwd-skill",
          "description: A skill that checks its working directory.",
          "---",
          "",
          "Current dir: [!`pwd`]",
        ].join("\n"),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { SkillTool } = await import("../../src/tool/skill")
      const skillTool = await SkillTool.init()
      const ctx = {
        sessionID: "test",
        messageID: "",
        callID: "",
        agent: "coder",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }

      const result = await skillTool.execute({ name: "cwd-skill" }, ctx)

      // Commands run in project directory, matching prompt.ts behavior
      expect(result.output).toContain(tmp.path)
    },
  })
})

test("handles failing shell commands gracefully", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "fail-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: fail-skill",
          "description: A skill with a failing command.",
          "---",
          "",
          "Result: [!`nonexistent_command_12345`]",
        ].join("\n"),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { SkillTool } = await import("../../src/tool/skill")
      const skillTool = await SkillTool.init()
      const ctx = {
        sessionID: "test",
        messageID: "",
        callID: "",
        agent: "coder",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }

      // Should not throw - failing commands are handled gracefully
      const result = await skillTool.execute({ name: "fail-skill" }, ctx)

      // The output should still be returned (with empty or error output from the command)
      expect(result.output).toContain("Result:")
      // The !`command` syntax should be replaced (not left as-is)
      expect(result.output).not.toContain("!`nonexistent_command_12345`")
    },
  })
})

test("handles commands that output nothing", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "empty-output-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: empty-output-skill",
          "description: A skill with a command that outputs nothing.",
          "---",
          "",
          "Before [!`true`] After",
        ].join("\n"),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { SkillTool } = await import("../../src/tool/skill")
      const skillTool = await SkillTool.init()
      const ctx = {
        sessionID: "test",
        messageID: "",
        callID: "",
        agent: "coder",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }

      const result = await skillTool.execute({ name: "empty-output-skill" }, ctx)

      // Command with no output should be replaced with empty string
      expect(result.output).toContain("Before [] After")
      expect(result.output).not.toContain("!`true`")
    },
  })
})

test("handles multiple skill executions correctly", async () => {
  // This test verifies that skills can be loaded multiple times in sequence.
  // Uses a local regex (matching prompt.ts pattern) instead of shared ConfigMarkdown.SHELL_REGEX
  // for defensive coding and consistency.
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "regex-test-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: regex-test-skill",
          "description: A skill to test regex state handling.",
          "---",
          "",
          'Value: [!`echo "test-value"`]',
        ].join("\n"),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { SkillTool } = await import("../../src/tool/skill")
      const skillTool = await SkillTool.init()
      const ctx = {
        sessionID: "test",
        messageID: "",
        callID: "",
        agent: "coder",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }

      // Execute the skill multiple times in sequence
      // If using a shared global regex, lastIndex state could cause failures
      for (let i = 0; i < 3; i++) {
        const result = await skillTool.execute({ name: "regex-test-skill" }, ctx)
        expect(result.output).toContain("Value: [test-value\n]")
        expect(result.output).not.toContain("!`echo")
      }
    },
  })
})

test("handles commands with special characters", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "special-chars-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: special-chars-skill",
          "description: A skill with special characters in commands.",
          "---",
          "",
          "Quoted string: [!`echo \"hello world\"`]",
          "With pipe: [!`echo test | cat`]",
        ].join("\n"),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { SkillTool } = await import("../../src/tool/skill")
      const skillTool = await SkillTool.init()
      const ctx = {
        sessionID: "test",
        messageID: "",
        callID: "",
        agent: "coder",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }

      const result = await skillTool.execute({ name: "special-chars-skill" }, ctx)

      // Commands with special characters should work
      expect(result.output).toContain("Quoted string: [hello world\n]")
      expect(result.output).toContain("With pipe: [test\n]")
      expect(result.output).not.toContain("!`echo")
    },
  })
})
