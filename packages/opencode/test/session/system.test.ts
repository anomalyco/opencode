import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { SystemPrompt } from "../../src/session/system"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, SystemPrompt.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("session.system", () => {
  it.live("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* Effect.all(
        [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ].map(([name, description]) =>
          Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", name, "SKILL.md"),
              `---
name: ${name}
description: ${description}
---

# ${name}
`,
            ),
          ),
        ),
        { discard: true },
      )

      const home = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = dir

      try {
        yield* Effect.gen(function* () {
          const build = yield* Agent.Service.use((svc) => svc.get("build"))
          if (!build) yield* Effect.fail(new NamedError.Unknown({ message: "missing build agent" }))

          const skills = SystemPrompt.Service.use((svc) => svc.skills(build))

          const first = yield* skills
          const second = yield* skills
          const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

          expect(first).toBe(second)

          const alpha = output.indexOf("<name>alpha-skill</name>")
          const middle = output.indexOf("<name>middle-skill</name>")
          const zeta = output.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        }).pipe(provideInstance(dir))
      } finally {
        process.env.OPENCODE_TEST_HOME = home
      }
    }),
  )
})
