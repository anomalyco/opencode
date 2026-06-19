import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { testEffect } from "../lib/effect"

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    type: "non-core",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    type: "core",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    type: "non-core",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
  {
    name: "manual-skill",
    type: "non-core",
    location: "/tmp/manual-skill/SKILL.md",
    content: "# manual-skill",
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

function makeLayer(skillsConfig?: { autoLoad?: "all" | "core" | "none" }) {
  const configInfo = skillsConfig ? { skills: skillsConfig } : {}
  return SystemPrompt.layer.pipe(
    Layer.provide(LocationServiceMap.layer),
    Layer.provide(
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((s) => s.name === name)),
          require: (name) => {
            const info = skills.find((s) => s.name === name)
            if (info) return Effect.succeed(info)
            return Effect.fail(new Skill.NotFoundError({ name, available: skills.map((s) => s.name) }))
          },
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
          loadIntoSession: () => Effect.succeed(""),
          isLoaded: () => Effect.succeed(false),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        Config.Service,
        Config.Service.of({
          get: () => Effect.succeed(configInfo),
          getGlobal: () => Effect.succeed({}),
          getConsoleState: () => Effect.succeed({ consoleManagedProviders: [], activeOrgName: undefined, switchableOrgCount: 0 }),
          update: () => Effect.void,
          updateGlobal: () => Effect.succeed({ info: {}, changed: false }),
          invalidate: () => Effect.void,
          directories: () => Effect.succeed([]),
          waitForDependencies: () => Effect.void,
        }),
      ),
    ),
  )
}

const it = testEffect(makeLayer())
const itCore = testEffect(makeLayer({ autoLoad: "core" }))
const itNone = testEffect(makeLayer({ autoLoad: "none" }))

describe("session.system", () => {
  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
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
      expect(output).not.toContain("manual-skill")
    }),
  )

  it.effect("autoLoad all includes all skills with descriptions", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = (yield* prompt.skills(build))!
      expect(output).toContain("<name>alpha-skill</name>")
      expect(output).toContain("<name>middle-skill</name>")
      expect(output).toContain("<name>zeta-skill</name>")
      expect(output).not.toContain("<name>manual-skill</name>")
    }),
  )

  itCore.effect("autoLoad core includes only core-tagged skills", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = (yield* prompt.skills(build))!
      expect(output).toContain("<name>alpha-skill</name>")
      expect(output).not.toContain("<name>middle-skill</name>")
      expect(output).not.toContain("<name>zeta-skill</name>")
    }),
  )

  itCore.effect("autoLoad core returns undefined when no core skills match agent", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.skills({ ...build, permission: Permission.fromConfig({ "*": "deny" }) })
      expect(output).toBeUndefined()
    }),
  )

  itNone.effect("autoLoad none includes no skills", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = (yield* prompt.skills(build))!
      expect(output).not.toContain("<name>")
      expect(output).toContain("No skills are currently available.")
    }),
  )

  it.effect("autoLoad missing config defaults to all", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = (yield* prompt.skills(build))!
      expect(output).toContain("<name>alpha-skill</name>")
      expect(output).toContain("<name>middle-skill</name>")
      expect(output).toContain("<name>zeta-skill</name>")
    }),
  )
})
