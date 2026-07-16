import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillInstructions } from "@opencode-ai/core/skill/instructions"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const build = AgentV2.ID.make("build")
const effect = SkillV2.Info.make({
  id: SkillV2.ID.make("effect"),
  name: SkillV2.Name.make("Effect"),
  description: "Build applications with Effect",
  location: AbsolutePath.make(path.resolve("/skills/effect/SKILL.md")),
  content: "Effect guidance",
})
const hidden = SkillV2.Info.make({
  id: SkillV2.ID.make("hidden"),
  name: SkillV2.Name.make("Hidden"),
  location: AbsolutePath.make(path.resolve("/skills/hidden/SKILL.md")),
  content: "Undescribed guidance",
})
const denied = SkillV2.Info.make({
  id: SkillV2.ID.make("denied"),
  name: SkillV2.Name.make("Denied"),
  description: "Must not be advertised",
  location: AbsolutePath.make(path.resolve("/skills/denied/SKILL.md")),
  content: "Denied guidance",
})
const manual = SkillV2.Info.make({
  id: SkillV2.ID.make("manual"),
  name: SkillV2.Name.make("Manual"),
  description: "Load only when explicitly selected",
  autoinvoke: false,
  location: AbsolutePath.make(path.resolve("/skills/manual/SKILL.md")),
  content: "Manual guidance",
})

const layer = (list: () => SkillV2.Info[]) =>
  AppNodeBuilder.build(SkillInstructions.node, [
    [SkillV2.node, Layer.mock(SkillV2.Service, { list: () => Effect.succeed(list()) })],
  ])

describe("SkillInstructions", () => {
  it.effect("renders described agent skills and updates the complete available list", () => {
    const agent = AgentV2.Info.make({
      ...AgentV2.Info.empty(build),
      permissions: [{ action: "skill", resource: "denied", effect: "deny" }],
    })
    let skills = [hidden, denied, manual, effect]
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      const initialized = yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))

      expect(initialized.text).toBe(
        [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          "<available_skills>",
          "  <skill>",
          "    <id>effect</id>",
          "    <name>Effect</name>",
          "    <description>Build applications with Effect</description>",
          "  </skill>",
          "</available_skills>",
        ].join("\n"),
      )
      expect(initialized.text).not.toContain("manual")

      skills = []
      expect(
        yield* instructions
          .load({ id: agent.id, info: agent })
          .pipe(Effect.flatMap((context) => readUpdate(context, initialized))),
      ).toMatchObject({ text: "Skill guidance is no longer available. Do not use any previously listed skill." })
    }).pipe(Effect.provide(layer(() => skills)))
  })

  it.effect("announces added and removed skills as deltas without restating the list", () => {
    const agent = AgentV2.Info.make(AgentV2.Info.empty(build))
    const debugging = SkillV2.Info.make({
      id: SkillV2.ID.make("debugging"),
      name: SkillV2.Name.make("Debugging"),
      description: "Diagnose hard bugs",
      location: AbsolutePath.make(path.resolve("/skills/debugging/SKILL.md")),
      content: "Debugging guidance",
    })
    let skills = [effect]
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      const initialized = yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))

      skills = [effect, debugging]
      const added = yield* instructions
        .load({ id: agent.id, info: agent })
        .pipe(Effect.flatMap((context) => readUpdate(context, initialized)))
      expect(added.text).toBe(
        [
          "New skills are available in addition to those previously listed:",
          "  <skill>",
          "    <id>debugging</id>",
          "    <name>Debugging</name>",
          "    <description>Diagnose hard bugs</description>",
          "  </skill>",
        ].join("\n"),
      )

      skills = [debugging]
      const removed = yield* instructions
        .load({ id: agent.id, info: agent })
        .pipe(Effect.flatMap((context) => readUpdate(context, added)))
      expect(removed.text).toBe("The following skill IDs are no longer available and must not be used: effect.")
    }).pipe(Effect.provide(layer(() => skills)))
  })

  it.effect("restates the full skill list when a description changes", () => {
    const agent = AgentV2.Info.make(AgentV2.Info.empty(build))
    let skills = [effect]
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      const initialized = yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))

      skills = [SkillV2.Info.make({ ...effect, description: "Build applications with Effect v4" })]
      expect(
        yield* instructions
          .load({ id: agent.id, info: agent })
          .pipe(Effect.flatMap((context) => readUpdate(context, initialized))),
      ).toMatchObject({
        text: expect.stringContaining(
          "The available skills have changed. This list supersedes the previous available skills list.",
        ),
      })
    }).pipe(Effect.provide(layer(() => skills)))
  })

  it.effect("omits instructions when the selected agent denies all skills", () => {
    const agent = AgentV2.Info.make({
      ...AgentV2.Info.empty(build),
      permissions: [{ action: "skill", resource: "*", effect: "deny" }],
    })
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      expect((yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))).text).toBe("")
    }).pipe(Effect.provide(layer(() => [effect])))
  })

  it.effect("omits instructions when a resource-specific denial follows the global denial", () => {
    const agent = AgentV2.Info.make({
      ...AgentV2.Info.empty(build),
      permissions: [
        { action: "skill", resource: "*", effect: "deny" },
        { action: "skill", resource: "hidden", effect: "deny" },
      ],
    })
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      expect((yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))).text).toBe("")
    }).pipe(Effect.provide(layer(() => [effect])))
  })

  it.effect("retains specifically allowed skills after a global denial", () => {
    const agent = AgentV2.Info.make({
      ...AgentV2.Info.empty(build),
      permissions: [
        { action: "skill", resource: "*", effect: "deny" },
        { action: "skill", resource: "effect", effect: "allow" },
      ],
    })
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      expect(
        (yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))).text,
      ).toContain("<name>Effect</name>")
    }).pipe(Effect.provide(layer(() => [effect])))
  })

  it.effect("omits instructions when a specifically allowed skill is denied again", () => {
    const agent = AgentV2.Info.make({
      ...AgentV2.Info.empty(build),
      permissions: [
        { action: "skill", resource: "*", effect: "deny" },
        { action: "skill", resource: "effect", effect: "allow" },
        { action: "skill", resource: "effect", effect: "deny" },
      ],
    })
    return Effect.gen(function* () {
      const instructions = yield* SkillInstructions.Service
      expect((yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))).text).toBe("")
    }).pipe(Effect.provide(layer(() => [effect])))
  })
})
