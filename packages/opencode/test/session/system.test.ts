import { describe, expect, test } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { ProviderID } from "../../src/provider/schema"
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

  test("anthropic prompt only includes todo instructions when todowrite is available", () => {
    const model = {
      providerID: ProviderID.make("anthropic"),
      api: { id: "claude-sonnet-4-5" },
    } as any

    const withoutTodo = SystemPrompt.provider(model, { tools: [] }).join("\n")
    expect(withoutTodo).not.toContain("Use these tools VERY frequently")
    expect(withoutTodo).not.toContain("Always use the TodoWrite tool")

    const withTodo = SystemPrompt.provider(model, { tools: ["todowrite", "todoread"] }).join("\n")
    expect(withTodo).toContain("Use these tools VERY frequently")
    expect(withTodo).toContain("Always use the TodoWrite tool")
  })
})
