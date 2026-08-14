import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CommandV2 } from "@moks/core/command"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { Location } from "@moks/core/location"
import { CommandPlugin } from "@moks/core/plugin/command"
import { AbsolutePath } from "@moks/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const directory = AbsolutePath.make("/repo/packages/app")
const project = AbsolutePath.make("/repo")
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory }, { projectDirectory: project })),
)
const it = testEffect(AppNodeBuilder.build(CommandV2.node, [[Location.node, locationLayer]]))

describe("CommandPlugin.Plugin", () => {
  it.effect("registers built-in init and review commands", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      yield* CommandPlugin.Plugin.effect(
        host({
          command: { transform: command.transform, reload: command.reload },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      expect(yield* command.get("init")).toMatchObject({
        name: "init",
        description: "scaffold this directory as a requisition (HIRING.md + candidates/)",
      })
      expect((yield* command.get("init"))?.template).toContain("`/repo/packages/app`")
      expect((yield* command.get("init"))?.template).toContain("HIRING.md")
      expect(yield* command.get("init-code")).toBeUndefined()
      expect(yield* command.get("review")).toMatchObject({
        name: "review",
        description: "review candidate/req packet before commit/push",
        subtask: true,
      })
      expect((yield* command.get("review"))?.template).toContain("hiring packet")
    }),
  )
})
