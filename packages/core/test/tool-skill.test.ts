import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillTool } from "@opencode-ai/core/tool/skill"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { toolIdentity, executeTool, registerToolPlugin, settleTool, toolDefinitions } from "./lib/tool"

const skillToolNode = makeLocationNode({
  name: "test/skill-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(SkillTool.Plugin)),
  deps: [ToolRegistry.toolsNode, FSUtil.node, SkillV2.node, PermissionV2.node],
})

const sessionID = SessionV2.ID.make("ses_skill_tool_test")

describe("SkillTool", () => {
  it.live("lists available skills, authorizes the selected ID, and loads model-facing content", () =>
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
            id: SkillV2.ID.make("effect"),
            name: SkillV2.Name.make("Effect"),
            description: "Use Effect",
            location: AbsolutePath.make(location),
            content: "# Effect\n\nGuidance",
          }
          let current = [info]
          const assertions: PermissionV2.AssertInput[] = []
          let deny = false
          const permission = Layer.succeed(
            PermissionV2.Service,
            PermissionV2.Service.of({
              assert: (input) =>
                Effect.sync(() => assertions.push(input)).pipe(
                  Effect.andThen(
                    deny
                      ? Effect.fail(
                          new PermissionV2.BlockedError({
                            rules: [],
                            permission: input.action,
                            resources: input.resources,
                          }),
                        )
                      : Effect.void,
                  ),
                ),
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
              transform: (_transform) => Effect.die("unused"),
              reload: () => Effect.die("unused"),
              sources: () => Effect.die("unused"),
              list: () => Effect.succeed(current),
            }),
          )
          const skillToolLayer = AppNodeBuilder.build(
            LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, skillToolNode]),
            [
              [PermissionV2.node, permission],
              [SkillV2.node, skills],
              [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
            ],
          )

          return yield* Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            expect((yield* toolDefinitions(registry))[0]).toMatchObject({
              name: "skill",
              description: SkillTool.description,
            })
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-skill", name: "skill", input: { id: "effect" } },
              }),
            ).toEqual({
              type: "text",
              value: SkillTool.toModelOutput(info, [reference]),
            })
            expect(SkillTool.toModelOutput(info, [reference])).toContain(`Base directory for this skill: ${directory}`)
            expect(
              yield* settleTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-skill-overflow", name: "skill", input: { id: "effect" } },
              }),
            ).toMatchObject({
              result: { type: "text", value: SkillTool.toModelOutput(info, [reference]) },
              output: { structured: { name: "Effect" } },
            })
            expect(assertions).toMatchObject([
              { sessionID, action: "skill", resources: ["effect"], save: ["effect"] },
              { sessionID, action: "skill", resources: ["effect"], save: ["effect"] },
            ])
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-missing-skill", name: "skill", input: { id: "missing" } },
              }),
            ).toEqual({ type: "error", value: "Unable to load skill missing" })
            deny = true
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-denied-skill", name: "skill", input: { id: "effect" } },
              }),
            ).toEqual({ type: "error", value: "Unable to load skill effect" })
            deny = false
            const flat = SkillV2.Info.make({
              id: SkillV2.ID.make("public"),
              name: SkillV2.Name.make("Public"),
              description: "Public guidance",
              location: AbsolutePath.make(path.join(tmp.path, "public.md")),
              content: "Public",
            })
            yield* Effect.promise(() =>
              Promise.all([
                fs.writeFile(flat.location, "public"),
                fs.writeFile(path.join(tmp.path, "secret.md"), "secret"),
              ]),
            )
            current = [flat]
            expect(
              yield* executeTool(registry, {
                sessionID,
                ...toolIdentity,
                call: { type: "tool-call", id: "call-flat-skill", name: "skill", input: { id: "public" } },
              }),
            ).toEqual({ type: "text", value: SkillTool.toModelOutput(flat, []) })
          }).pipe(Effect.provide(skillToolLayer))
        }),
      ),
    ),
  )
})
