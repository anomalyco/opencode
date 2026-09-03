import { expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { Plugin } from "@opencode-ai/core/plugin"
import { Skill } from "@opencode-ai/core/skill"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const skill = {
  id: Skill.ID.make("review"),
  name: Skill.Name.make("Review"),
  description: "Review changes",
  location: AbsolutePath.make("/fixture/review.md"),
  content: "Review changes",
}

for (const cause of [new TypeError("synthetic-private-detail"), "synthetic-private-detail"]) {
  it.effect(`attributes a deferred skill transform throwing ${typeof cause}`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const skills = yield* Skill.Service
      let setup = false
      const activation = yield* plugins
        .activate([
          {
            id: "healthy",
            revision: "1",
            effect: (ctx) => ctx.skill.transform((editor) => editor.add(skill)).pipe(Effect.asVoid),
          },
          {
            id: "broken-skills",
            revision: "1",
            effect: (ctx) =>
              Effect.gen(function* () {
                yield* ctx.skill.transform((editor) => {
                  editor.remove(skill.id)
                  throw cause
                })
                setup = true
              }),
          },
        ])
        .pipe(Effect.exit)

      expect(setup).toBe(true)
      // Neither a partial fold nor the old value is returned after failure. Every read retries.
      for (const exit of [
        activation,
        yield* skills.list().pipe(Effect.asVoid, Effect.exit),
        yield* skills.get(skill.id).pipe(Effect.asVoid, Effect.exit),
      ]) {
        if (Exit.isSuccess(exit)) throw new Error("Expected a failed skill fold")
        expect(Cause.hasFails(exit.cause)).toBe(false)
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "PluginCallbackError",
          pluginID: "broken-skills",
          operation: "skill.transform",
          message: 'Plugin "broken-skills" failed during skill.transform.',
          cause,
        })
      }

      // Only an explicit registration change removes the failure; nothing is silently disabled.
      yield* plugins.activate([
        {
          id: "healthy",
          revision: "1",
          effect: (ctx) => ctx.skill.transform((editor) => editor.add(skill)).pipe(Effect.asVoid),
        },
      ])
      expect(yield* skills.list()).toEqual([skill])
    }),
  )
}

it.effect("keeps setup failures distinct from deferred callback failures", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const skills = yield* Skill.Service
    yield* plugins.activate([
      { id: "setup-failure", revision: "1", effect: () => Effect.die(new Error("fixture setup failed")) },
      {
        id: "healthy",
        revision: "1",
        effect: (ctx) => ctx.skill.transform((editor) => editor.add(skill)).pipe(Effect.asVoid),
      },
    ])
    expect((yield* plugins.list()).find((plugin) => plugin.id === "setup-failure")?.state).toMatchObject({
      status: "failed",
      error: expect.stringContaining("fixture setup failed"),
    })
    expect(yield* skills.list()).toEqual([skill])
  }),
)
