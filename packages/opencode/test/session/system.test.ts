import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { ULTRACODE_SYSTEM_SECTION, WORKFLOW_TRIGGER_GUIDANCE } from "../../src/tool/workflow"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { testEffect } from "../lib/effect"
import { Workflow } from "../../src/workflow/workflow"

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
  {
    name: "manual-skill",
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

// Item 13: an agent whose ruleset denies the workflow tool outright — the
// ultracode section must never appear for it.
const noWorkflow: Agent.Info = {
  name: "no-workflow",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow", workflow: "deny" }),
  options: {},
}

const it = testEffect(
  SystemPrompt.layer.pipe(
    Layer.provide(LocationServiceMap.layer),
    Layer.provide(
      Layer.succeed(
        Workflow.Service,
        Workflow.Service.of({
          list: () =>
            Effect.succeed([
              {
                name: "release_notes",
                path: "/tmp/release_notes.ts",
                meta: {
                  name: "Release Notes",
                  description: "Draft release notes.",
                  phases: [{ title: "draft" }, { title: "review" }],
                  arguments: {
                    version: { type: "string", description: "Version to summarize." },
                  },
                },
                valid: true,
              },
            ]),
          read: () => Effect.succeed(undefined),
          runs: () => Effect.succeed([]),
          get: () => Effect.succeed(undefined),
          start: () => Effect.fail(new Workflow.NotFoundError({ name: "test" })),
          wait: () => Effect.succeed({ timedOut: false }),
          cancel: () => Effect.succeed(undefined),
          pause: () => Effect.succeed(undefined),
          skipAgent: () => Effect.succeed(undefined),
          answer: () => Effect.succeed(undefined),
          save: () => Effect.succeed({ path: "/tmp/test.ts" }),
          export: () => Effect.succeed(undefined),
          remove: () => Effect.succeed(false),
          sweep: () => Effect.void,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          require: (name) => {
            const info = skills.find((skill) => skill.name === name)
            if (info) return Effect.succeed(info)
            return Effect.fail(new Skill.NotFoundError({ name, available: skills.map((skill) => skill.name) }))
          },
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ),
  ),
)

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
      expect(output).toContain("<available_workflows>")
      expect(output).toContain("<name>release_notes</name>")
    }),
  )

  // Item 3: the workflow section carries the trigger list, the offer path with
  // its cost mention, and the hybrid-scout recommendation — verbatim from the
  // shared constant (the tool DESCRIPTION spreads the same one, so no drift).
  it.effect("workflow section names triggers, offer path, and hybrid scouting", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.skills(build)
      expect(output).toBeDefined()
      for (const line of WORKFLOW_TRIGGER_GUIDANCE) expect(output).toContain(line)
      expect(output).toContain("ultracode")
      expect(output).toContain("OFFER a workflow")
      expect(output).toContain("extra cost")
      expect(output).toContain("discover the work list inline first")
    }),
  )

  // Item 13: session.metadata.ultracode appends the standing opt-in section
  // (quality over cost) AFTER the workflow section — replacing the clients'
  // former per-message session directive.
  it.effect("ultracode opt-in section is appended after the workflow section", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.skills(build, { ultracode: true })
      expect(output).toBeDefined()
      expect(output).toContain(ULTRACODE_SYSTEM_SECTION)
      expect(output).toContain("quality over cost")
      expect(output).toContain("standing opt-in for the whole session")
      const workflowSection = output!.indexOf("<available_workflows>")
      const ultracodeSection = output!.indexOf(ULTRACODE_SYSTEM_SECTION)
      expect(workflowSection).toBeGreaterThan(-1)
      expect(ultracodeSection).toBeGreaterThan(workflowSection)
    }),
  )

  it.effect("no ultracode section without the flag", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const plain = yield* prompt.skills(build)
      const explicit = yield* prompt.skills(build, { ultracode: false })
      expect(plain).not.toContain(ULTRACODE_SYSTEM_SECTION)
      expect(explicit).not.toContain(ULTRACODE_SYSTEM_SECTION)
    }),
  )

  it.effect("workflow-permission deny suppresses the ultracode section", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.skills(noWorkflow, { ultracode: true })
      expect(output).toBeDefined()
      expect(output).not.toContain(ULTRACODE_SYSTEM_SECTION)
      expect(output).not.toContain("quality over cost")
      // The deny also hides the workflow roster itself (pre-existing behavior).
      expect(output).not.toContain("<available_workflows>")
    }),
  )
})
