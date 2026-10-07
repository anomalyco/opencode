import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { Document } from "@opencode/schema/config"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { testEffect } from "./lib/effect"
import { readInitial } from "./lib/instructions"

const configLayer = Config.testLayer()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Skill.node, SkillInstructions.node, Agent.node, Bus.node, ManagedPolicy.node]),
    [Config.node.replace(configLayer)],
  ).pipe(Layer.provideMerge(configLayer)),
)

const info = (id: string, description: string) =>
  Skill.Info.make({
    id: Skill.ID.make(id),
    name: Skill.Name.make(id),
    description,
    path: AbsolutePath.make(`/skills/${id}/SKILL.md`),
    content: `# ${id}`,
  })

describe("Skill", () => {
  it.effect("hides and refuses denied skills while organization policy overrides local allows", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      const managed = yield* ManagedPolicy.Service
      const config = yield* Config.Test
      yield* skills.transform((editor) => {
        editor.add(info("team:review", "Review"))
        editor.add(info("deploy", "Deploy"))
      })
      yield* config.setEntries([
        new Document({
          type: "document",
          info: {
            experimental: { policies: [{ action: "integration.use", resource: "skill:*", effect: "allow" }] },
          },
        }),
      ])
      yield* managed.set({
        statements: [
          { action: "integration.use", resource: "*", effect: "deny" },
          { action: "integration.use", resource: "skill:team:review", effect: "allow" },
        ],
      })
      expect(yield* skills.list()).toEqual([info("team:review", "Review")])
      expect(yield* skills.get(Skill.ID.make("deploy"))).toBeUndefined()
      expect(yield* skills.get(Skill.ID.make("team:review"))).toEqual(info("team:review", "Review"))
      const instructions = yield* SkillInstructions.Service
      const guidance = yield* instructions.load([]).pipe(Effect.flatMap(readInitial))
      expect(guidance.text).toContain("<id>team:review</id>")
      expect(guidance.text).not.toContain("deploy")

      yield* managed.set({ statements: [{ action: "integration.use", resource: "skill:team:review", effect: "deny" }] })
      expect(yield* skills.get(Skill.ID.make("team:review"))).toBeUndefined()
      expect(yield* skills.list()).toEqual([info("deploy", "Deploy")])
      yield* managed.set({ statements: [] })
      expect(yield* skills.list()).toHaveLength(2)
    }),
  )

  it.effect("applies configuration precedence to skills without changing their registered values", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      const config = yield* Config.Test
      yield* skills.transform((editor) => editor.add(info("review", "Review")))
      yield* config.setEntries([
        new Document({
          type: "document",
          info: { experimental: { policies: [{ action: "integration.use", resource: "skill:*", effect: "deny" }] } },
        }),
        new Document({
          type: "document",
          info: {
            experimental: { policies: [{ action: "integration.use", resource: "skill:review", effect: "allow" }] },
          },
        }),
      ])
      expect(yield* skills.list()).toEqual([])
      expect(yield* skills.get(Skill.ID.make("review"))).toBeUndefined()
      yield* config.setEntries([])
      expect(yield* skills.get(Skill.ID.make("review"))).toEqual(info("review", "Review"))
    }),
  )

  it.live("publishes catalog updates when managed policy changes", () =>
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      const managed = yield* ManagedPolicy.Service
      const bus = yield* Bus.Service
      yield* skills.transform((editor) => editor.add(info("review", "Review")))
      const updated = yield* Deferred.make<Skill.Info[]>()
      yield* bus.subscribe(Skill.Event.Updated).pipe(
        Stream.runForEach(() => skills.list().pipe(Effect.flatMap((values) => Deferred.succeed(updated, values)))),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* managed.set({ statements: [{ action: "integration.use", resource: "skill:review", effect: "deny" }] })
      expect(yield* Deferred.await(updated).pipe(Effect.timeout("1 second"))).toEqual([])
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
      expect(Skill.available([info("deploy", "Deploy")], agent!.permissions)).toEqual([])
    }),
  )
})
