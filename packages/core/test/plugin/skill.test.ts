import { describe, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Location } from "@opencode-ai/core/location"
import { Effect } from "effect"
import { SkillPlugin } from "@opencode-ai/core/plugin/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(SkillV2.node))

describe("SkillPlugin.Plugin", () => {
  it.effect("registers built-in skills", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* SkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } })).pipe(
        Effect.provideService(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) })),
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
        ),
        Effect.provide(AppNodeBuilder.build(FSUtil.node)),
        Effect.provide(NodeFileSystem.layer),
      )
      const skills = yield* skill.list()
      const report = skills.find((item) => item.name === "report")

      expect(skills).toContainEqual(
        expect.objectContaining({
          name: "customize-opencode",
          description: expect.stringContaining("opencode's own configuration"),
        }),
      )
      expect(skills).toContainEqual(
        expect.objectContaining({
          name: "report",
          description: expect.stringContaining("opencode issue"),
        }),
      )
      expect(report?.slash).toBe(true)
      expect(report?.content).toContain(`- opencode version: ${InstallationVersion}`)
    }),
  )
})
