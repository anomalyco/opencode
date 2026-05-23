import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Cause, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
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

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node, AppFileSystem.defaultLayer))

describe("tool.skill", () => {
  it.live("execute returns skill content block with files", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const skill = path.join(dir, ".opencode", "skill", "tool-skill")
        yield* AppFileSystem.use.writeWithDirs(
          path.join(skill, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
`,
        )
        yield* AppFileSystem.use.writeWithDirs(path.join(skill, "scripts", "demo.txt"), "demo")

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
          providerID: ProviderID.opencode,
          modelID: ModelID.make("gpt-5"),
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
    ),
  )

  it.live("execute preserves not found message", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
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
          providerID: ProviderID.opencode,
          modelID: ModelID.make("gpt-5"),
          agent,
        })).find((tool) => tool.id === SkillTool.id)
        if (!tool) throw new Error("Skill tool not found")

        const exit = yield* tool
          .execute(
            { name: "missing-skill" },
            {
              ...baseCtx,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause)
          expect(error).toBeInstanceOf(Error)
          if (error instanceof Error) expect(error.message).toContain('Skill "missing-skill" not found.')
        }
      }),
    ),
  )
})
