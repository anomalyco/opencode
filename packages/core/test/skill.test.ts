import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Skill } from "@opencode-ai/core/skill"
import { Preferences } from "@opencode-ai/core/preferences"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Skill.node, Agent.node, Bus.node, Preferences.node])))

const info = (id: string, description: string) =>
  Skill.Info.make({
    id: Skill.ID.make(id),
    name: Skill.Name.make(id),
    description,
    location: AbsolutePath.make(`/skills/${id}/SKILL.md`),
    content: `# ${id}`,
  })

describe("Skill", () => {
  it.effect("applies preferences after registration precedence and preserves disabled inventory", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      const preferences = yield* Preferences.Service
      const target = { kind: "skill", id: Skill.ID.make("review") } as const
      yield* skills.transform((editor) => editor.add(info("review", "First")))
      yield* preferences.set(target, "disabled")
      yield* skills.transform((editor) => editor.add(info("review", "Override")))
      yield* skills.reload()
      expect(yield* skills.list()).toEqual([info("review", "Override")])
      expect(yield* skills.get(target.id).pipe(Effect.flip)).toBeInstanceOf(Skill.DisabledError)
      yield* preferences.reset(target)
      expect(yield* skills.get(target.id)).toEqual(info("review", "Override"))
      expect(yield* skills.list()).toEqual([info("review", "Override")])
    }),
  )

  it.effect("reads the current editor entry by ID", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* skill.transform((editor) => editor.add(info("review", "Initial")))
      yield* skill.transform((editor) => {
        expect(editor.get("review")).toBe(editor.list()[0])
        expect(editor.get("missing")).toBeUndefined()
        editor.update("review", (value) => {
          value.description = "Updated"
        })
        expect(editor.get("review")?.description).toBe("Updated")
        editor.remove("review")
        expect(editor.get("review")).toBeUndefined()
      })

      expect(yield* skill.list()).toEqual([])
    }),
  )

  it.effect("registers values with last-write-wins precedence", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* skill.transform((editor) => {
        editor.add(info("review", "First"))
        editor.add(info("deploy", "Deploy"))
        editor.add(info("review", "Second"))
        expect(editor.list().map((item) => item.id)).toEqual([Skill.ID.make("review"), Skill.ID.make("deploy")])
      })

      expect(yield* skill.list()).toEqual([info("review", "Second"), info("deploy", "Deploy")])
      expect(yield* skill.get(Skill.ID.make("review"))).toEqual(info("review", "Second"))
      expect(yield* skill.get(Skill.ID.make("missing"))).toBeUndefined()
    }),
  )

  it.effect("updates and removes registered values", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* skill.transform((editor) => {
        editor.add(info("review", "Initial"))
        editor.update("review", (value) => {
          value.description = "Updated"
          value.id = Skill.ID.make("ignored")
        })
        editor.update("missing", () => {
          throw new Error("unreachable")
        })
        editor.add(info("deploy", "Deploy"))
        editor.remove("deploy")
      })

      expect(yield* skill.list()).toEqual([info("review", "Updated")])
    }),
  )

  it.effect("restores earlier values when an updating transform is disposed", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const original = info("review", "Initial")
      yield* skill.transform((editor) => editor.add(original))
      const updated = yield* skill.transform((editor) =>
        editor.update("review", (value) => {
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

      yield* skill.transform((editor) => editor.add(info("review", "Visible")))
      expect(yield* Deferred.await(updated).pipe(Effect.timeout("1 second"))).toEqual([info("review", "Visible")])
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect("filters values by agent permissions", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.permissions.push({ action: "skill", resource: "deploy", effect: "deny" })
        }),
      )
      const agent = yield* agents.get(Agent.ID.make("reviewer"))
      expect(Skill.available([info("deploy", "Deploy")], agent!)).toEqual([])
    }),
  )
})
