import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CommandV2 } from "@opencode-ai/core/command"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { CommandPlugin } from "@opencode-ai/core/plugin/command"
import { AbsolutePath } from "@opencode-ai/core/schema"
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
        description: "scaffold a requisition under .moks/reqs/<slug>",
      })
      expect((yield* command.get("init"))?.template).toContain("`/repo`")
      expect((yield* command.get("init"))?.template).toContain(".moks/")
      expect(yield* command.get("init-code")).toMatchObject({
        name: "init-code",
        description: "guided AGENTS.md setup for coding agents",
      })
      expect((yield* command.get("init-code"))?.template).toContain("AGENTS.md")
      expect(yield* command.get("review")).toMatchObject({
        name: "review",
        description: "review candidate/req packet before commit/push",
        subtask: true,
      })
      expect((yield* command.get("review"))?.template).toContain("hiring packet")
    }),
  )
})
