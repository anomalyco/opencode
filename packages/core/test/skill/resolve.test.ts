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

const info = (id: string, name: string) =>
  Skill.Info.make({
    id: Skill.ID.make(id),
    name: Skill.Name.make(name),
    path: AbsolutePath.make(`/skills/${id}/SKILL.md`),
    content: `${id} instructions`,
  })

const directory = AbsolutePath.make("/project")
const location = Layer.succeed(Location.Service, {
  directory,
  project: { id: Project.ID.make("prj_resolve_test"), directory, canonical: directory },
})
const layer = AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node, Config.node, Location.node]), [
  Location.node.replace(location),
])

const withSkills = (skills: ReadonlyArray<Skill.Info>) =>
  Effect.gen(function* () {
    const service = yield* Skill.Service
    yield* service.transform((editor) => skills.forEach((skill) => editor.add(skill)))
    return service
  }).pipe(Effect.provide(layer))

describe("Skill.Service.get", () => {
  it.effect("resolves a skill by its ID", () =>
    Effect.gen(function* () {
      const skills = yield* withSkills([info("release", "Git Release")])
      expect(yield* skills.get(Skill.ID.make("release"))).toMatchObject({ id: "release", name: "Git Release" })
    }),
  )

  it.effect("resolves a skill by the name it advertises, however deeply it is nested", () =>
    Effect.gen(function* () {
      const skills = yield* withSkills([info("my-skill", "acme:my-skill")])
      expect(yield* skills.get(Skill.ID.make("acme:my-skill"))).toMatchObject({ id: "my-skill", name: "acme:my-skill" })
    }),
  )

  it.effect("prefers an ID over a name that another skill carries", () =>
    Effect.gen(function* () {
      const skills = yield* withSkills([info("release", "Git Release"), info("other", "release")])
      expect(yield* skills.get(Skill.ID.make("release"))).toMatchObject({ id: "release" })
    }),
  )

  it.effect("refuses a name that two skills share rather than guessing", () =>
    Effect.gen(function* () {
      const skills = yield* withSkills([info("first", "Shared"), info("second", "Shared")])
      expect(yield* skills.get(Skill.ID.make("Shared"))).toBeUndefined()
    }),
  )

  it.effect("still reports an unknown id as missing", () =>
    Effect.gen(function* () {
      const skills = yield* withSkills([info("release", "Git Release")])
      expect(yield* skills.get(Skill.ID.make("missing"))).toBeUndefined()
    }),
  )
})
