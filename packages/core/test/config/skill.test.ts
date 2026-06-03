import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/tmpdir"

const it = testEffect(FSUtil.defaultLayer)
const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigSkillPlugin.Plugin", () => {
  it.effect("registers configured skill directories and URLs", () =>
    Effect.gen(function* () {
      const directory = AbsolutePath.make("/repo/packages/app")
      const sources: SkillV2.Source[] = []
      const transform = Effect.fnUntraced(function* () {
        return Effect.fnUntraced(function* (update: (editor: SkillV2.Editor) => void) {
          update({
            source: (source) => sources.push(source),
            list: () => sources,
          })
        })
      })

      yield* ConfigSkillPlugin.Plugin.effect.pipe(
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  info: decode({
                    skills: ["./skills", "~/shared-skills", "/opt/skills", "https://example.test/skills/"],
                  }),
                }),
              ]),
          }),
        ),
        Effect.provideService(Global.Service, Global.Service.of(Global.make({ home: "/home/test" }))),
        Effect.provideService(Location.Service, Location.Service.of(location({ directory }))),
        Effect.provideService(
          SkillV2.Service,
          SkillV2.Service.of({
            transform,
            sources: () => Effect.succeed(sources),
            list: () => Effect.succeed([]),
            forAgent: () => Effect.succeed([]),
          }),
        ),
      )

      expect(sources).toEqual([
        new SkillV2.DirectorySource({ type: "directory", path: AbsolutePath.make(path.join(directory, "skills")) }),
        new SkillV2.DirectorySource({ type: "directory", path: AbsolutePath.make("/home/test/shared-skills") }),
        new SkillV2.DirectorySource({ type: "directory", path: AbsolutePath.make("/opt/skills") }),
        new SkillV2.UrlSource({ type: "url", url: "https://example.test/skills/" }),
      ])
    }),
  )

  it.live("registers legacy commands as slash skills", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "commands", "nested"), { recursive: true })
            await fs.writeFile(
              path.join(tmp.path, "commands", "review.md"),
              `---
description: File review
agent: reviewer
model: anthropic/claude
subtask: true
---
Review files`,
            )
            await fs.writeFile(path.join(tmp.path, "commands", "nested", "docs.md"), "Write docs")
          })

          const sources: SkillV2.Source[] = []
          const transform = Effect.fnUntraced(function* () {
            return Effect.fnUntraced(function* (update: (editor: SkillV2.Editor) => void) {
              update({
                source: (source) => sources.push(source),
                list: () => sources,
              })
            })
          })

          yield* ConfigSkillPlugin.Plugin.effect.pipe(
            Effect.provideService(
              Config.Service,
              Config.Service.of({
                entries: () =>
                  Effect.succeed([
                    new Config.Document({
                      type: "document",
                      path: path.join(tmp.path, "opencode.json"),
                      info: decode({ commands: { review: { template: "Inline review" } } }),
                    }),
                    new Config.Directory({ type: "directory", path: AbsolutePath.make(tmp.path) }),
                  ]),
              }),
            ),
            Effect.provideService(Global.Service, Global.Service.of(Global.make({ home: "/home/test" }))),
            Effect.provideService(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) }))),
            Effect.provideService(
              SkillV2.Service,
              SkillV2.Service.of({
                transform,
                sources: () => Effect.succeed(sources),
                list: () => Effect.succeed([]),
                forAgent: () => Effect.succeed([]),
              }),
            ),
          )

          expect(sources).toEqual([
            new SkillV2.SkillSource({
              type: "skill",
              skill: new SkillV2.Info({
                name: "review",
                description: "File review",
                slash: true,
                subagent: true,
                agent: "reviewer",
                model: "anthropic/claude",
                location: AbsolutePath.make(path.join(tmp.path, "commands", "review.md")),
                content: "Review files",
              }),
            }),
            new SkillV2.SkillSource({
              type: "skill",
              skill: new SkillV2.Info({
                name: "nested/docs",
                slash: true,
                location: AbsolutePath.make(path.join(tmp.path, "commands", "nested", "docs.md")),
                content: "Write docs",
              }),
            }),
          ])
        }),
      ),
    ),
  )
})
