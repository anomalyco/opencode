import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "@/tool/tool"
import { Instance } from "../../src/project/instance"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
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
  await disposeAllInstances()
})

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))

describe("tool.skill", () => {
  it.live("execute returns skill content block with files", () =>
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

Use this skill.
`,
            ),
          )
          yield* Effect.promise(() => Bun.write(path.join(skill, "scripts", "demo.txt"), "demo"))

          const home = process.env.OPENCODE_TEST_HOME
          process.env.OPENCODE_TEST_HOME = dir
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.env.OPENCODE_TEST_HOME = home
            }),
          )

          const registry = yield* ToolRegistry.Service
          const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
          const tool = (yield* registry.tools({
            providerID: "opencode" as any,
            modelID: "gpt-5" as any,
            agent,
          })).find((tool) => tool.id === SkillTool.id)
          if (!tool) throw new Error("Skill tool not found")

          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const ctx: Tool.Context = {
            ...baseCtx,
            ask: (req) =>
              Effect.sync(() => {
                requests.push(req)
              }),
          }

          const result = yield* tool.execute({ name: "tool-skill" }, ctx)
          const file = path.resolve(skill, "scripts", "demo.txt")

          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("skill")
          expect(requests[0].patterns).toContain("tool-skill")
          expect(requests[0].always).toContain("tool-skill")
          expect(result.metadata.dir).toBe(skill)
          expect(result.output).toContain(`<skill_content name="tool-skill">`)
          expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(skill).href}`)
          expect(result.output).toContain(`<file>${file}</file>`)
        }),
      { git: true },
    ),
  )
})
