import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Skill } from "@opencode-ai/core/skill"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Skill.node, Agent.node, Bus.node])))

const info = (id: string, description: string) =>
  Skill.Info.make({
    id: Skill.ID.make(id),
    name: Skill.Name.make(id),
    description,
    location: AbsolutePath.make(`/skills/${id}/SKILL.md`),
    content: `# ${id}`,
  })

describe("Skill", () => {
  it.effect("registers values with last-write-wins precedence", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* skill.transform((draft) => {
        draft.add(info("review", "First"))
        draft.add(info("deploy", "Deploy"))
        draft.add(info("review", "Second"))
        expect(draft.list().map((item) => item.id)).toEqual([Skill.ID.make("review"), Skill.ID.make("deploy")])
      })

      expect(yield* skill.list()).toEqual([info("review", "Second"), info("deploy", "Deploy")])
      expect(yield* skill.get(Skill.ID.make("review"))).toEqual(info("review", "Second"))
      expect(yield* skill.get(Skill.ID.make("missing"))).toBeUndefined()
    }),
  )

  it.effect("updates and removes registered values", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* skill.transform((draft) => {
        draft.add(info("review", "Initial"))
        draft.update("review", (value) => {
          value.description = "Updated"
          value.id = Skill.ID.make("ignored")
        })
        draft.update("missing", () => Effect.die("unreachable"))
        draft.add(info("deploy", "Deploy"))
        draft.remove("deploy")
      })

      expect(yield* skill.list()).toEqual([info("review", "Updated")])
    }),
  )

  it.effect("restores earlier values when an updating transform is disposed", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const original = info("review", "Initial")
      yield* skill.transform((draft) => draft.add(original))
      const updated = yield* skill.transform((draft) =>
        draft.update("review", (value) => {
          value.description = "Updated"
        }),
      )

      expect((yield* skill.list())[0]?.description).toBe("Updated")
      yield* updated.dispose
      expect((yield* skill.list())[0]?.description).toBe("Initial")
      expect(original.description).toBe("Initial")
    }),
  )

  it.live("publishes updates after committed values are visible", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const bus = yield* Bus.Service
      const updated = yield* Deferred.make<Skill.Info[]>()
      const fiber = yield* bus.subscribe(Skill.Event.Updated).pipe(
        Stream.runForEach(() => skill.list().pipe(Effect.flatMap((values) => Deferred.succeed(updated, values)))),
        Effect.forkScoped,
      )
      yield* Effect.yieldNow

      yield* skill.transform((draft) => draft.add(info("review", "Visible")))
      expect(yield* Deferred.await(updated).pipe(Effect.timeout("1 second"))).toEqual([info("review", "Visible")])
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect("filters values by agent permissions", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((draft) =>
        draft.update(Agent.ID.make("reviewer"), (agent) => {
          agent.permissions.push({ action: "skill", resource: "deploy", effect: "deny" })
        }),
      )
      const agent = yield* agents.get(Agent.ID.make("reviewer"))
      expect(Skill.available([info("deploy", "Deploy")], agent!)).toEqual([])
    }),
  )
})
