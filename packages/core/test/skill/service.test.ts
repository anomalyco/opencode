import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { it } from "../lib/effect"

// The service resolves by path-derived ID only. Loading by display name is the
// skill tool's job, which keeps `skill://` URIs and the read tool ID-only too.
const directory = AbsolutePath.make("/project")
const layer = AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node, Config.node, Location.node]), [
  Location.node.replace(
    Layer.succeed(Location.Service, {
      directory,
      project: { id: Project.ID.make("prj_skill_service_test"), directory, canonical: directory },
    }),
  ),
])

describe("Skill.Service", () => {
  it.effect("resolves by ID and leaves the display name to the caller", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      yield* skills.transform((editor) =>
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("my-skill"),
            name: Skill.Name.make("acme:my-skill"),
            path: AbsolutePath.make("/skills/my-skill/SKILL.md"),
            content: "instructions",
          }),
        ),
      )

      expect(yield* skills.get(Skill.ID.make("my-skill"))).toMatchObject({ id: "my-skill", name: "acme:my-skill" })
      expect(yield* skills.get(Skill.ID.make("acme:my-skill"))).toBeUndefined()
    }).pipe(Effect.provide(layer)),
  )
})
