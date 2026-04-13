import { Effect } from "effect"
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { attach } from "../../src/effect/run-service"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.skill", () => {
  test("description lists skill location URL", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill
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
          const desc = await ToolRegistry.tools({
            providerID: "opencode" as any,
            modelID: "gpt-5" as any,
            agent: { name: "build", mode: "primary" as const, permission: [], options: {} },
          }).then((tools) => tools.find((tool) => tool.id === SkillTool.id)?.description ?? "")
          expect(desc).toContain(`**tool-skill**: Skill for tool tests.`)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("description sorts skills by name and is stable across calls", async () => {
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
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const load = () =>
            ToolRegistry.tools({
              providerID: "opencode" as any,
              modelID: "gpt-5" as any,
              agent,
            }).then((tools) => tools.find((tool) => tool.id === SkillTool.id)?.description ?? "")
          const first = await load()
          const second = await load()

          expect(first).toBe(second)

          const alpha = first.indexOf("**alpha-skill**: Alpha skill.")
          const middle = first.indexOf("**middle-skill**: Middle skill.")
          const zeta = first.indexOf("**zeta-skill**: Zeta skill.")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("execute returns skill content block with files", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "tool-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
`,
        )
        await Bun.write(path.join(skillDir, "scripts", "demo.txt"), "demo")
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const tool = await ToolRegistry.tools({
            providerID: "opencode" as any,
            modelID: "gpt-5" as any,
            agent,
          }).then((tools) => tools.find((tool) => tool.id === SkillTool.id))
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const dir = path.join(tmp.path, ".opencode", "skill", "tool-skill")
          const file = path.resolve(dir, "scripts", "demo.txt")
          if (!tool) throw new Error("Skill tool not found")

          const ctx: Tool.Context = {
            ...baseCtx,
            ask: (req) =>
              Effect.sync(() => {
                requests.push(req)
              }),
          }

          const result = await Effect.runPromise(attach(tool.execute({ name: "tool-skill" }, ctx)))

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("skill")
          expect(requests[0].patterns).toContain("tool-skill")
          expect(requests[0].always).toContain("tool-skill")

          expect(result.metadata.dir).toBe(dir)
          expect(result.output).toContain(`<skill_content name="tool-skill">`)
          expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(dir).href}`)
          expect(result.output).toContain(`<file>${file}</file>`)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })
})
