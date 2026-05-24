import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Skill } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, AppFileSystem.defaultLayer, node))
const itWithoutClaudeCodeSkills = testEffect(
  Layer.mergeAll(
    Skill.layer.pipe(
      Layer.provide(Discovery.defaultLayer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Global.layer),
      Layer.provide(RuntimeFlags.layer({ disableClaudeCodeSkills: true })),
    ),
    AppFileSystem.defaultLayer,
    node,
  ),
)
const itWithoutExternalSkills = testEffect(
  Layer.mergeAll(
    Skill.layer.pipe(
      Layer.provide(Discovery.defaultLayer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Global.layer),
      Layer.provide(RuntimeFlags.layer({ disableExternalSkills: true })),
    ),
    AppFileSystem.defaultLayer,
    node,
  ),
)

const writeSkill = (dir: string, parts: string[], content: string) =>
  AppFileSystem.use.writeWithDirs(path.join(dir, ...parts, "SKILL.md"), content)

const createGlobalSkill = (homeDir: string) =>
  writeSkill(
    homeDir,
    [".claude", "skills", "global-test-skill"],
    `---
name: global-test-skill
description: A global skill from ~/.claude/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )

const withHome = <A, E, R>(home: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        process.env.OPENCODE_TEST_HOME = prev
      }),
  )

describe("skill", () => {
  it.instance(
    "discovers skills from .opencode/skill/ directory",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeSkill(
        test.directory,
        [".opencode", "skill", "test-skill"],
        `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
      )

      const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
      expect(list.length).toBe(1)
      const item = list.find((x) => x.name === "test-skill")
      expect(item).toBeDefined()
      expect(item!.description).toBe("A test skill for verification.")
      expect(item!.location).toContain(path.join("skill", "test-skill", "SKILL.md"))
    }),
    { git: true },
  )

  it.instance(
    "returns skill directories from Skill.dirs",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* withHome(
        test.directory,
        Effect.gen(function* () {
          yield* writeSkill(
            test.directory,
            [".opencode", "skill", "dir-skill"],
            `---
name: dir-skill
description: Skill for dirs test.
---

# Dir Skill
`,
          )

          const dirs = yield* Skill.use.dirs()
          expect(dirs).toContain(path.join(test.directory, ".opencode", "skill", "dir-skill"))
          expect(dirs.length).toBe(1)
        }),
      )
    }),
    { git: true },
  )

  it.instance(
    "discovers multiple skills from .opencode/skill/ directory",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.all(
        [
          writeSkill(
            test.directory,
            [".opencode", "skill", "skill-one"],
            `---
name: skill-one
description: First test skill.
---

# Skill One
`,
          ),
          writeSkill(
            test.directory,
            [".opencode", "skill", "skill-two"],
            `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
          ),
        ],
      )

      const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
      expect(list.length).toBe(2)
      expect(list.find((x) => x.name === "skill-one")).toBeDefined()
      expect(list.find((x) => x.name === "skill-two")).toBeDefined()
    }),
    { git: true },
  )

  it.instance(
    "skips skills with missing frontmatter",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeSkill(
        test.directory,
        [".opencode", "skill", "no-frontmatter"],
        `# No Frontmatter

Just some content without YAML frontmatter.
`,
      )

      expect((yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")).toEqual([])
    }),
    { git: true },
  )

  it.instance(
    "discovers skills without descriptions",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeSkill(
        test.directory,
        [".opencode", "skill", "manual-skill"],
        `---
name: manual-skill
---

# Manual Skill

Instructions here.
`,
      )

      const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
      expect(list.length).toBe(1)
      const item = list.find((x) => x.name === "manual-skill")
      expect(item).toBeDefined()
      expect(item!.description).toBeUndefined()
      expect(Skill.fmt(list, { verbose: false })).toBe("No skills are currently available.")
      expect(Skill.fmt(list, { verbose: true })).toBe("No skills are currently available.")
    }),
    { git: true },
  )

  it.instance(
    "discovers skills from .claude/skills/ directory",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeSkill(
        test.directory,
        [".claude", "skills", "claude-skill"],
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )

      const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
      expect(list.length).toBe(1)
      const item = list.find((x) => x.name === "claude-skill")
      expect(item).toBeDefined()
      expect(item!.location).toContain(path.join(".claude", "skills", "claude-skill", "SKILL.md"))
    }),
    { git: true },
  )

  it.instance(
    "discovers global skills from ~/.claude/skills/ directory",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* withHome(
        test.directory,
        Effect.gen(function* () {
          yield* createGlobalSkill(test.directory)
          const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          expect(list[0].name).toBe("global-test-skill")
          expect(list[0].description).toBe("A global skill from ~/.claude/skills for testing.")
          expect(list[0].location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
        }),
      )
    }),
    { git: true },
  )

  it.instance(
    "returns empty array when no skills exist",
    Effect.gen(function* () {
      expect((yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")).toEqual([])
    }),
    { git: true },
  )

  it.instance(
    "fails with typed error when requiring a missing skill",
    Effect.gen(function* () {
      const error = yield* Effect.flip(Skill.use.require("missing-skill"))
      expect(error).toBeInstanceOf(Skill.NotFoundError)
      expect(error._tag).toBe("Skill.NotFoundError")
      expect(error.name).toBe("missing-skill")
      expect(error.message).toContain('Skill "missing-skill" not found.')
    }),
    { git: true },
  )

  it.effect("exposes tagged expected skill failure classes", () =>
    Effect.sync(() => {
      const invalid = new Skill.InvalidError({ path: "/tmp/SKILL.md", message: "Invalid skill frontmatter" })
      const mismatch = new Skill.NameMismatchError({
        path: "/tmp/SKILL.md",
        expected: "expected-skill",
        actual: "actual-skill",
      })

      expect(invalid).toBeInstanceOf(Skill.InvalidError)
      expect(invalid._tag).toBe("SkillInvalidError")
      expect(mismatch).toBeInstanceOf(Skill.NameMismatchError)
      expect(mismatch._tag).toBe("SkillNameMismatchError")
    }),
  )

  it.instance(
    "discovers skills from .agents/skills/ directory",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeSkill(
        test.directory,
        [".agents", "skills", "agent-skill"],
        `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
      )

      const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
      expect(list.length).toBe(1)
      const item = list.find((x) => x.name === "agent-skill")
      expect(item).toBeDefined()
      expect(item!.location).toContain(path.join(".agents", "skills", "agent-skill", "SKILL.md"))
    }),
    { git: true },
  )

  it.instance(
    "discovers global skills from ~/.agents/skills/ directory",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* withHome(
        test.directory,
        Effect.gen(function* () {
          yield* writeSkill(
            test.directory,
            [".agents", "skills", "global-agent-skill"],
            `---
name: global-agent-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill

This skill is loaded from the global home directory.
`,
          )

          const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          expect(list[0].name).toBe("global-agent-skill")
          expect(list[0].description).toBe("A global skill from ~/.agents/skills for testing.")
          expect(list[0].location).toContain(path.join(".agents", "skills", "global-agent-skill", "SKILL.md"))
        }),
      )
    }),
    { git: true },
  )

  it.instance(
    "discovers skills from both .claude/skills/ and .agents/skills/",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.all(
        [
          writeSkill(
            test.directory,
            [".claude", "skills", "claude-skill"],
            `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
          ),
          writeSkill(
            test.directory,
            [".agents", "skills", "agent-skill"],
            `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
          ),
        ],
      )

      const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
      expect(list.length).toBe(2)
      expect(list.find((x) => x.name === "claude-skill")).toBeDefined()
      expect(list.find((x) => x.name === "agent-skill")).toBeDefined()
    }),
    { git: true },
  )

  itWithoutClaudeCodeSkills.instance(
    "skips Claude Code skills when disabled",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.all(
        [
          writeSkill(
            test.directory,
            [".claude", "skills", "claude-skill"],
            `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
          ),
          writeSkill(
            test.directory,
            [".agents", "skills", "agent-skill"],
            `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
          ),
        ],
      )

      const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
      expect(list.map((s) => s.name)).toEqual(["agent-skill"])
    }),
    { git: true },
  )

  itWithoutExternalSkills.instance(
    "skips external skill directories when disabled",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.all(
        [
          writeSkill(
            test.directory,
            [".claude", "skills", "claude-skill"],
            `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
          ),
          writeSkill(
            test.directory,
            [".agents", "skills", "agent-skill"],
            `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
          ),
          writeSkill(
            test.directory,
            [".opencode", "skill", "opencode-skill"],
            `---
name: opencode-skill
description: A skill in the .opencode/skill directory.
---

# OpenCode Skill
`,
          ),
        ],
      )

      const list = (yield* Skill.use.all()).filter((s) => s.location !== "<built-in>")
      expect(list.map((s) => s.name)).toEqual(["opencode-skill"])
    }),
    { git: true },
  )

  it.instance(
    "properly resolves directories that skills live in",
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.all(
        [
          writeSkill(
            test.directory,
            [".claude", "skills", "claude-skill"],
            `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
          ),
          writeSkill(
            test.directory,
            [".agents", "skills", "agent-skill"],
            `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
          ),
          writeSkill(
            test.directory,
            [".opencode", "skill", "agent-skill"],
            `---
name: opencode-skill
description: A skill in the .opencode/skill directory.
---

# OpenCode Skill
`,
          ),
          writeSkill(
            test.directory,
            [".opencode", "skills", "agent-skill"],
            `---
name: opencode-skill
description: A skill in the .opencode/skills directory.
---

# OpenCode Skill
`,
          ),
        ],
      )

      expect((yield* Skill.use.dirs()).length).toBe(4)
    }),
    { git: true },
  )
})
