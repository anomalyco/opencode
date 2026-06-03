import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillTool } from "@opencode-ai/core/tool/skill"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_skill_tool_test")

describe("SkillTool", () => {
  it.live("lists available skills, authorizes the selected name, and loads model-facing content", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const directory = path.join(tmp.path, "effect")
          const location = path.join(directory, "SKILL.md")
          const reference = path.join(directory, "reference.md")
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
          yield* Effect.promise(() =>
            Promise.all([fs.writeFile(location, "unused"), fs.writeFile(reference, "reference")]),
          )

          const info: SkillV2.Info = {
            name: "effect",
            description: "Use Effect",
            location: AbsolutePath.make(location),
            content: "# Effect\n\nGuidance",
          }
          const assertions: PermissionV2.AssertInput[] = []
          let bootWaited = false
          const boot = Layer.succeed(
            PluginBoot.Service,
            PluginBoot.Service.of({ wait: () => Effect.sync(() => { bootWaited = true }) }),
          )
          const permission = Layer.succeed(
            PermissionV2.Service,
            PermissionV2.Service.of({
              assert: (input) => Effect.sync(() => assertions.push(input)),
              ask: () => Effect.die("unused"),
              reply: () => Effect.die("unused"),
              get: () => Effect.die("unused"),
              forSession: () => Effect.die("unused"),
              list: () => Effect.die("unused"),
            }),
          )
          const skills = Layer.succeed(
            SkillV2.Service,
            SkillV2.Service.of({
              transform: () => Effect.die("unused"),
              sources: () => Effect.die("unused"),
              list: () => Effect.succeed([info]),
              forAgent: () => Effect.die("unused"),
            }),
          )
          const registry = ToolRegistry.layer.pipe(Layer.provide(permission))
          const tool = SkillTool.layer.pipe(
            Layer.provide(registry),
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(boot),
            Layer.provide(skills),
          )
          const layer = Layer.mergeAll(permission, skills, registry, boot, tool)

          return yield* Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            expect(bootWaited).toBe(true)
            expect((yield* registry.definitions())[0]).toMatchObject({
              name: "skill",
              description: expect.stringContaining("**effect**: Use Effect"),
            })
            expect(
              yield* registry.execute({
                sessionID,
                call: { type: "tool-call", id: "call-skill", name: "skill", input: { name: "effect" } },
              }),
            ).toEqual({
              type: "text",
              value: SkillTool.toModelOutput(info, [reference]),
            })
            expect(assertions).toEqual([{ sessionID, action: "skill", resources: ["effect"], save: ["effect"] }])
            expect(
              yield* registry.execute({
                sessionID,
                call: { type: "tool-call", id: "call-missing-skill", name: "skill", input: { name: "missing" } },
              }),
            ).toEqual({ type: "error", value: 'Skill "missing" not found. Available skills: effect' })
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )
})
