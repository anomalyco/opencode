import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"

const workspaceID = Workspace.ID.make("wrk_test")
const ref = { directory: AbsolutePath.make("/repo/packages/app"), workspaceID }
const projectLayer = Layer.succeed(
  Project.Service,
  Project.Service.of({
    list: () => Effect.succeed([]),
    update: () => Effect.die("unused"),
    resolve: () =>
      Effect.succeed({
        id: Project.ID.make("project"),
        directory: AbsolutePath.make("/repo"),
        canonical: AbsolutePath.make("/main/repo"),
        vcs: { type: "git", store: AbsolutePath.make("/repo/.git") },
      }),
  }),
)
const it = testEffect(AppNodeBuilder.build(Location.boundNode(ref), [[Project.node, projectLayer]]))

describe("Location", () => {
  it.effect("resolves the current project and vcs information", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service

      expect(location.directory).toBe(AbsolutePath.make("/repo/packages/app"))
      expect(location.workspaceID).toBe(workspaceID)
      expect(location.project.id).toBe(Project.ID.make("project"))
      expect(location.project.directory).toBe(AbsolutePath.make("/repo"))
      expect(location.project.canonical).toBe(AbsolutePath.make("/main/repo"))
      expect(location.vcs).toEqual({
        type: "git",
        store: AbsolutePath.make("/repo/.git"),
      })
    }),
  )
})
