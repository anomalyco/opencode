import { describe, expect, test } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { ModelID, ProviderID } from "../../src/provider/schema"
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

  test("runtime system prompt overrides provider prompt selection", () => {
    const prompt = SystemPrompt.provider({
      id: ModelID.make("compound"),
      providerID: ProviderID.make("groq"),
      name: "Compound",
      family: "",
      api: {
        id: "compound",
        url: "https://api.groq.com",
        npm: "@ai-sdk/groq",
      },
      capabilities: {
        temperature: false,
        reasoning: false,
        attachment: false,
        toolcall: false,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128000, output: 4096 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-01-01",
      variants: {},
      runtime: { systemPrompt: "groq" },
    })

    expect(prompt).toHaveLength(1)
    expect(prompt[0]).toContain("interactive CLI coding assistant")
  })

  test("gpt-5 models use codex prompt by default", () => {
    const prompt = SystemPrompt.provider({
      id: ModelID.make("gpt-5.4"),
      providerID: ProviderID.openai,
      name: "GPT-5.4",
      family: "",
      api: {
        id: "gpt-5.4",
        url: "https://api.openai.com/v1",
        npm: "@ai-sdk/openai",
      },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128000, output: 4096 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-01-01",
      variants: {},
      runtime: {},
    })

    expect(prompt).toHaveLength(1)
    expect(prompt[0]).toContain("best coding agent on the planet")
  })
})
