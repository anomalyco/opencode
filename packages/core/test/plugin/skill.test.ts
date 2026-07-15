import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { SkillPlugin } from "@opencode-ai/core/plugin/skill"
import { SkillV2 } from "@opencode-ai/core/skill"
import { testEffect } from "../lib/effect"
import { host } from "./host"

// Regression: the skill previously used "env" which is stripped by the schema parser.
// The correct field is "environment" (matches McpLocalConfig schema and mcp/index.ts runtime).
test("customize-opencode skill uses correct 'environment' key for MCP local server env vars", () => {
  const content = readFileSync(
    join(import.meta.dir, "../../src/plugin/skill/customize-opencode.md"),
    "utf-8",
  )
  expect(content).not.toMatch(/"env":\s*\{/)
  expect(content).toContain('"environment"')
})

const it = testEffect(AppNodeBuilder.build(SkillV2.node))

describe("SkillPlugin.Plugin", () => {
  it.effect("registers the built-in customize-opencode skill", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* SkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      expect(yield* skill.list()).toContainEqual(
        expect.objectContaining({
          name: "customize-opencode",
          description: expect.stringContaining("opencode's own configuration"),
        }),
      )
    }),
  )
})
