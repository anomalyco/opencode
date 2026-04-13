import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Agent } from "../../src/agent/agent"
import { Skill } from "../../src/skill"
import { Ripgrep } from "../../src/file/ripgrep"
import { Truncate } from "../../src/tool/truncate"
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "../../src/tool/registry"
import { provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

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

const node = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))

describe("tool.skill", () => {
  it.live("description lists skill location URL", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const skill = path.join(dir, ".opencode", "skill", "tool-skill")
          yield* Effect.promise(() =>
            Bun.write(
              path.join(skill, "SKILL.md"),
              `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill
`,
            ),
          )
          const home = process.env.OPENCODE_TEST_HOME
          process.env.OPENCODE_TEST_HOME = dir
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.OPENCODE_TEST_HOME = home
            }),
          )
          const registry = yield* ToolRegistry.Service
          const desc =
            (yield* registry.tools({
              providerID: "opencode" as any,
              modelID: "gpt-5" as any,
              agent: { name: "build", mode: "primary", permission: [], options: {} },
            })).find((tool) => tool.id === SkillTool.id)?.description ?? ""
          expect(desc).toContain("**tool-skill**: Skill for tool tests.")
        }),
      { git: true },
    ),
  )

  it.live("description sorts skills by name and is stable across calls", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          for (const [name, description] of [
            ["zeta-skill", "Zeta skill."],
            ["alpha-skill", "Alpha skill."],
            ["middle-skill", "Middle skill."],
          ]) {
            const skill = path.join(dir, ".opencode", "skill", name)
            yield* Effect.promise(() =>
              Bun.write(
                path.join(skill, "SKILL.md"),
                `---
name: ${name}
description: ${description}
---

# ${name}
`,
              ),
            )
          }
          const home = process.env.OPENCODE_TEST_HOME
          process.env.OPENCODE_TEST_HOME = dir
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.OPENCODE_TEST_HOME = home
            }),
          )

          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const registry = yield* ToolRegistry.Service
          const load = Effect.fnUntraced(function* () {
            return (
              (yield* registry.tools({
                providerID: "opencode" as any,
                modelID: "gpt-5" as any,
                agent,
              })).find((tool) => tool.id === SkillTool.id)?.description ?? ""
            )
          })
          const first = yield* load()
          const second = yield* load()

          expect(first).toBe(second)

          const alpha = first.indexOf("**alpha-skill**: Alpha skill.")
          const middle = first.indexOf("**middle-skill**: Middle skill.")
          const zeta = first.indexOf("**zeta-skill**: Zeta skill.")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        }),
      { git: true },
    ),
  )

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
          const runtime = ManagedRuntime.make(
            Layer.mergeAll(Skill.defaultLayer, Ripgrep.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
          )
          const info = await runtime.runPromise(SkillTool)
          const tool = await runtime.runPromise(info.init())
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: (req) =>
              Effect.sync(() => {
                requests.push(req)
              }),
          }

          const result = await runtime.runPromise(tool.execute({ name: "tool-skill" }, ctx))
          const dir = path.join(tmp.path, ".opencode", "skill", "tool-skill")
          const file = path.resolve(dir, "scripts", "demo.txt")

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
