import { afterEach, test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { Plugin } from "../../src/plugin"
import { ToolRegistry } from "../../src/tool/registry"
import { Instance } from "../../src/project/instance"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

afterEach(async () => {
  await Instance.disposeAll()
})

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

const toolCtx = {
  sessionID: SessionID.make("ses_test-plugin-skill"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
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
      expect(testSkill!.location).toContain(path.join("skill", "test-skill", "SKILL.md"))
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
      expect(claudeSkill!.location).toContain(path.join(".claude", "skills", "claude-skill", "SKILL.md"))
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
        expect(skills[0].location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
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
      expect(agentSkill!.location).toContain(path.join(".agents", "skills", "agent-skill", "SKILL.md"))
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
        expect(skills[0].location).toContain(path.join(".agents", "skills", "global-agent-skill", "SKILL.md"))
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

test("discovers skills from config.skills.paths", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const configSkillDir = path.join(dir, "config-skills", "config-skill")
      await Bun.write(
        path.join(configSkillDir, "SKILL.md"),
        `---
name: config-skill
description: A skill registered via config.skills.paths.
---

# Config Skill
`,
      )
    },
  })

  // Write config after tmpdir is created
  const configSkillsPath = path.join(tmp.path, "config-skills")
  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      skills: {
        paths: [configSkillsPath],
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      const configSkill = skills.find((s) => s.name === "config-skill")
      expect(configSkill).toBeDefined()
      expect(configSkill!.description).toBe("A skill registered via config.skills.paths.")
    },
  })
})

test("Skill.get() returns skill from config.skills.paths", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const configSkillDir = path.join(dir, "config-skills", "get-test-skill")
      await Bun.write(
        path.join(configSkillDir, "SKILL.md"),
        `---
name: get-test-skill
description: Skill for get() test.
---

# Get Test Skill
`,
      )
    },
  })

  const configSkillsPath = path.join(tmp.path, "config-skills")
  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      skills: {
        paths: [configSkillsPath],
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("get-test-skill")
      expect(skill).toBeDefined()
      expect(skill!.name).toBe("get-test-skill")
      expect(skill!.description).toBe("Skill for get() test.")
    },
  })
})

test("Skill.dirs() includes config.skills.paths directories", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const configSkillDir = path.join(dir, "config-skills", "dirs-test-skill")
      await Bun.write(
        path.join(configSkillDir, "SKILL.md"),
        `---
name: dirs-test-skill
description: Skill for dirs() test.
---

# Dirs Test Skill
`,
      )
    },
  })

  const configSkillsPath = path.join(tmp.path, "config-skills")
  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      skills: {
        paths: [configSkillsPath],
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Skill.dirs()
      const configSkillDir = path.join(tmp.path, "config-skills", "dirs-test-skill")
      expect(dirs).toContain(configSkillDir)
    },
  })
})

test("Skill.get() returns undefined for missing skills", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("nonexistent-skill")
      expect(skill).toBeUndefined()
    },
  })
})

test("backward compatibility: existing opencode and claude skill loading still works with config.skills.paths", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const opencodeSkillDir = path.join(dir, ".opencode", "skill", "opencode-skill")
      const claudeSkillDir = path.join(dir, ".claude", "skills", "claude-skill")
      const configSkillDir = path.join(dir, "config-skills", "config-skill")
      await Bun.write(
        path.join(opencodeSkillDir, "SKILL.md"),
        `---
name: opencode-skill
description: Skill in .opencode/skill directory.
---

# OpenCode Skill
`,
      )
      await Bun.write(
        path.join(claudeSkillDir, "SKILL.md"),
        `---
name: claude-skill
description: Skill in .claude/skills directory.
---

# Claude Skill
`,
      )
      await Bun.write(
        path.join(configSkillDir, "SKILL.md"),
        `---
name: config-skill
description: Skill in config.skills.paths.
---

# Config Skill
`,
      )
    },
  })

  const configSkillsPath = path.join(tmp.path, "config-skills")
  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      skills: {
        paths: [configSkillsPath],
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(3)
      expect(skills.find((s) => s.name === "opencode-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "claude-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "config-skill")).toBeDefined()
    },
  })
})


test("PluginInput.skills works in plugin tool execute after config hooks populate skills.paths", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const pluginDir = path.join(dir, ".opencode", "plugin")
      const configSkillDir = path.join(dir, "plugin-config-skills", "plugin-config-skill")
      await fs.mkdir(pluginDir, { recursive: true })
      await Bun.write(
        path.join(configSkillDir, "SKILL.md"),
        `---
name: plugin-config-skill
description: A skill registered by a plugin config hook.
---

# Plugin Config Skill
`,
      )
      await Bun.write(
        path.join(pluginDir, "plugin-skill-check.ts"),
        [
          'import { tool } from "@opencode-ai/plugin"',
          '',
          'export default async (input) => ({',
          '  config: async (config) => {',
          '    config.skills ??= {}',
          '    config.skills.paths ??= []',
          '    config.skills.paths.push("./plugin-config-skills")',
          '  },',
          '  tool: {',
          '    "plugin-skill-check": tool({',
          '      description: "Checks PluginInput.skills access",',
          '      args: {},',
          '      execute: async () => {',
          '        const skill = await input.skills.get("plugin-config-skill")',
          '        const dirs = await input.skills.dirs()',
          '        const all = await input.skills.all()',
          '        return JSON.stringify({',
          '          name: skill?.name,',
          '          description: skill?.description,',
          '          dirs,',
          '          count: all.length,',
          '        })',
          '      },',
          '    }),',
          '  },',
          '})',
          '',
        ].join("\n"),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Plugin.init()
      const tools = await ToolRegistry.tools({
        providerID: ProviderID.opencode,
        modelID: ModelID.make("gpt-5"),
      })
      const pluginTool = tools.find((tool) => tool.id === "plugin-skill-check")
      expect(pluginTool).toBeDefined()
      const result = await pluginTool!.execute({}, toolCtx)
      const parsed = JSON.parse(result.output) as {
        name?: string
        description?: string
        dirs: string[]
        count: number
      }
      expect(parsed.name).toBe("plugin-config-skill")
      expect(parsed.description).toBe("A skill registered by a plugin config hook.")
      expect(parsed.count).toBeGreaterThanOrEqual(1)
      expect(parsed.dirs).toContain(path.join(tmp.path, "plugin-config-skills", "plugin-config-skill"))
    },
  })
})
