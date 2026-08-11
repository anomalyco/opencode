import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Directory, Document, Info } from "@opencode-ai/schema/config"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Effect, Schema, Stream } from "effect"
import { SkillPlugin } from "@opencode-ai/core/plugin/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Skill } from "@opencode-ai/core/skill"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
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

  it.effect("reports canonical configured plugin sources with existing labels and ordering", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.tap((tmp) =>
        Effect.promise(async () => {
          await fs.mkdir(path.join(tmp.path, "plugin"), { recursive: true })
          await fs.writeFile(path.join(tmp.path, "plugin", "discovered.ts"), "")
        }),
      ),
      Effect.flatMap((tmp) => {
        const config = path.join(tmp.path, "config", "opencode.json")
        const external = path.join(tmp.path, "external.ts")
        const labels = [
          "-disabled",
          path.join(tmp.path, "config", "relative.ts"),
          path.join(tmp.path, "plugin", "discovered.ts"),
          external,
          "package-plugin",
          "package-plugin",
        ].toSorted()
        return Effect.gen(function* () {
          const skill = yield* Skill.Service
          yield* SkillPlugin.Plugin.effect(
            host({
              skill: {
                list: () => Effect.die("unused skill.list"),
                transform: skill.transform,
                reload: skill.reload,
              },
            }),
          )
          const report = (yield* skill.list()).find((item) => item.id === "report")
          expect(report?.content).toContain(`- Active plugins: ${labels.join(", ")}`)
        }).pipe(
          Effect.provide(
            Config.testLayer([
              new Document({
                type: "document",
                path: config,
                info: Schema.decodeUnknownSync(Info)({
                  plugins: [
                    "./relative.ts",
                    "package-plugin",
                    { package: "package-plugin", options: { enabled: true } },
                    pathToFileURL(external).href,
                    "-disabled",
                  ],
                }),
              }),
              new Directory({ type: "directory", path: AbsolutePath.make(tmp.path) }),
            ]),
          ),
          Effect.provideService(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
          ),
          Effect.provide(AppNodeBuilder.build(FSUtil.node)),
          Effect.provide(NodeFileSystem.layer),
        )
      }),
    ),
  )
})
