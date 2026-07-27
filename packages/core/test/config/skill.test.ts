import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { Global } from "@opencode-ai/util/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Skill } from "@opencode-ai/core/skill"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const it = testEffect(Layer.empty)
const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigSkillPlugin.Plugin", () => {
  it.effect("registers configured skill directories and URLs", () =>
    Effect.gen(function* () {
      const directory = AbsolutePath.make("/repo/packages/app")
      const sources: Skill.Source[] = []
      const transform = Effect.fnUntraced(function* (update: (draft: Skill.Draft) => void | Effect.Effect<void>) {
        const result = update({
          source: (source) => {
            sources.push(source)
          },
          list: () => sources,
        })
        if (Effect.isEffect(result)) yield* result
        const dispose = Effect.sync(() => {
          sources.length = 0
        })
        yield* Effect.addFinalizer(() => dispose)
        return { dispose }
      })

      yield* ConfigSkillPlugin.Plugin.effect(
        host({
          skill: { list: () => Effect.die("unused skill.list"), transform, reload: () => Effect.void },
        }),
      ).pipe(
        Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home: "/home/test" })),
        Effect.provideService(Location.Service, Location.Service.of(location({ directory }))),
        Effect.provide(
          Config.testLayer([
            new Config.ClaudeDirectory({ type: "claude", path: AbsolutePath.make("/repo/.claude") }),
            new Config.AgentsDirectory({ type: "agents", path: AbsolutePath.make("/repo/.agents") }),
            new Config.Directory({ type: "directory", path: AbsolutePath.make("/repo/.opencode") }),
            new Config.Document({
              type: "document",
              info: decode({
                skills: ["./skills", "~/shared-skills", "/opt/skills", "https://example.test/skills/"],
              }),
            }),
          ]),
        ),
      )

      expect(sources).toEqual([
        Skill.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/repo/.claude", "skills")),
        }),
        Skill.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/repo/.agents", "skills")),
        }),
        Skill.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/repo/.opencode", "skill")),
        }),
        Skill.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/repo/.opencode", "skills")),
        }),
        Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make(path.join(directory, "skills")) }),
        Skill.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/home/test", "shared-skills")),
        }),
        Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make("/opt/skills") }),
        Skill.UrlSource.make({ type: "url", url: "https://example.test/skills/" }),
      ])
    }),
  )
})
