import { describe, expect, test } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { tmpdir } from "../fixture/fixture"

describe("session.system", () => {
  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const first = await SystemPrompt.skills(build!)
          const second = await SystemPrompt.skills(build!)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("environment includes context-budget block when provided", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = (
          await SystemPrompt.environment(
            {
              providerID: "openai",
              api: { id: "gpt-5" },
            } as unknown as Provider.Model,
            {
              budget: {
                max_context_tokens: 200000,
                used_tokens: 47823,
                remaining_context_tokens: 152177,
                compaction_threshold: 0.9,
                compaction_triggers_at: 180000,
                compactions_total: 0,
                current_step: 3,
                max_steps: 25,
              },
            },
          )
        )[0]

        expect(out).toContain("<context-budget>")
        expect(out).toContain("max_context_tokens: 200000")
        expect(out).toContain("used_tokens: 47823")
        expect(out).toContain("remaining_context_tokens: 152177")
        expect(out).toContain("compaction_triggers_at: 180000")
        expect(out).toContain("current_step: 3")
        expect(out).toContain("max_steps: 25")
      },
    })
  })
})
