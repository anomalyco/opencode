import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { emptyConsoleState } from "@/config/console-state"
import { Skill } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { SystemPrompt } from "../../src/session/system"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, CrossSpawnSpawner.defaultLayer))

const configLayer = (dir: string) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () => Effect.succeed({}),
      getGlobal: () => Effect.succeed({}),
      getConsoleState: () => Effect.succeed(emptyConsoleState),
      update: () => Effect.void,
      updateGlobal: (config) => Effect.succeed(config),
      invalidate: () => Effect.void,
      directories: () => Effect.succeed([path.join(dir, ".opencode")]),
      waitForDependencies: () => Effect.void,
    }),
  )

const systemPromptLayer = (dir: string) =>
  SystemPrompt.layer.pipe(
    Layer.provide(
      Skill.layer.pipe(
        Layer.provide(Discovery.defaultLayer),
        Layer.provide(configLayer(dir)),
        Layer.provide(Bus.layer),
        Layer.provide(AppFileSystem.defaultLayer),
        Layer.provide(Global.layerWith({ home: dir, config: path.join(dir, ".opencode") })),
      ),
    ),
  )

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

      yield* Effect.gen(function* () {
        const agent = yield* Agent.Service
        const prompt = yield* SystemPrompt.Service
        const build = yield* agent.get("build")
        const first = yield* prompt.skills(build)
        const second = yield* prompt.skills(build)
        const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

        expect(first).toBe(second)

        const alpha = output.indexOf("<name>alpha-skill</name>")
        const middle = output.indexOf("<name>middle-skill</name>")
        const zeta = output.indexOf("<name>zeta-skill</name>")

        expect(alpha).toBeGreaterThan(-1)
        expect(middle).toBeGreaterThan(alpha)
        expect(zeta).toBeGreaterThan(middle)
      }).pipe(provideInstance(dir), Effect.provide(systemPromptLayer(dir)))
    }),
  )
})
