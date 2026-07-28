import { describe, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Effect, Stream } from "effect"
import { SkillPlugin } from "@opencode-ai/core/plugin/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Skill } from "@opencode-ai/core/skill"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(Skill.node))

describe("SkillPlugin.Plugin", () => {
  it.effect("registers built-in skills", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* SkillPlugin.Plugin.effect(
        host({
          app: { name: "test", version: "1.2.3", channel: "beta" },
          skill: {
            list: () => Effect.die("unused skill.list"),
            transform: skill.transform,
            reload: skill.reload,
          },
        }),
      ).pipe(
        Effect.provide(Config.testLayer()),
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
        ),
        Effect.provide(AppNodeBuilder.build(FSUtil.node)),
        Effect.provide(NodeFileSystem.layer),
      )
      const skills = yield* skill.list()
      const report = skills.find((item) => item.id === "report")

      expect(skills).toContainEqual(
        expect.objectContaining({
          id: "opencode",
          name: "OpenCode",
          description: expect.stringContaining("any question about OpenCode itself"),
        }),
      )
      expect(skills).toContainEqual(
        expect.objectContaining({
          id: "report",
          name: "Report",
          description: expect.stringContaining("opencode issue"),
        }),
      )
      expect(report?.slash).toBe(true)
      expect(report?.content).toContain("- opencode version: 1.2.3")
      expect(report?.content).toContain("- install/channel: beta")
    }),
  )
})
