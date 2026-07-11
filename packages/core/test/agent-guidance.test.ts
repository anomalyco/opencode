import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { SubagentGuidance } from "@opencode-ai/core/agent/guidance"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { it } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

const info = (id: string, input: Partial<AgentV2.Info> = {}) =>
  AgentV2.Info.make({ ...AgentV2.Info.empty(AgentV2.ID.make(id)), ...input })

const explore = info("explore", { mode: "subagent", description: "Search the codebase" })
const reviewer = info("reviewer", { mode: "subagent", description: "Review code changes" })
const hidden = info("hidden", { mode: "subagent", hidden: true, description: "Internal agent" })
const primary = info("plan", { mode: "primary", description: "Plan changes" })

const layer = (list: () => AgentV2.Info[]) =>
  AppNodeBuilder.build(SubagentGuidance.node, [
    [AgentV2.node, Layer.mock(AgentV2.Service, { list: () => Effect.succeed(list()) })],
  ])

describe("SubagentGuidance", () => {
  it.effect("lists only visible subagents permitted for the selected agent", () => {
    const selected = info("build", {
      mode: "primary",
      permissions: [
        { action: "subagent", resource: "*", effect: "deny" },
        { action: "subagent", resource: "explore", effect: "allow" },
      ],
    })
    return Effect.gen(function* () {
      const guidance = yield* SubagentGuidance.Service
      const initialized = yield* guidance.load({ id: selected.id, info: selected }).pipe(Effect.flatMap(readInitial))

      expect(initialized.text).toBe(
        [
          "Use the subagent tool to delegate work only to the agents listed below.",
          "<available_subagents>",
          "  <subagent>",
          "    <id>explore</id>",
          "    <description>Search the codebase</description>",
          "  </subagent>",
          "</available_subagents>",
        ].join("\n"),
      )
      expect(initialized.text).not.toContain("reviewer")
      expect(initialized.text).not.toContain("hidden")
      expect(initialized.text).not.toContain("plan")
    }).pipe(Effect.provide(layer(() => [reviewer, primary, hidden, explore])))
  })

  it.effect("tracks permission and catalog changes as instruction updates", () => {
    const selected = info("build", { mode: "primary" })
    let agents = [explore]
    return Effect.gen(function* () {
      const guidance = yield* SubagentGuidance.Service
      const initialized = yield* guidance.load({ id: selected.id, info: selected }).pipe(Effect.flatMap(readInitial))

      agents = [reviewer]
      const updated = yield* guidance
        .load({ id: selected.id, info: selected })
        .pipe(Effect.flatMap((instructions) => readUpdate(instructions, initialized)))
      expect(updated.text).toBe(
        [
          "New subagents are available in addition to those previously listed:",
          "  <subagent>",
          "    <id>reviewer</id>",
          "    <description>Review code changes</description>",
          "  </subagent>",
          "The following subagent IDs are no longer available and must not be used: explore.",
        ].join("\n"),
      )

      agents = []
      expect(
        yield* guidance
          .load({ id: selected.id, info: selected })
          .pipe(Effect.flatMap((instructions) => readUpdate(instructions, updated))),
      ).toMatchObject({
        text: "Subagent guidance is no longer available. Do not use any previously listed subagent.",
      })
    }).pipe(Effect.provide(layer(() => agents)))
  })

  it.effect("omits guidance when the selected agent is unresolved", () =>
    Effect.gen(function* () {
      const guidance = yield* SubagentGuidance.Service
      expect(
        (yield* guidance.load({ id: AgentV2.ID.make("missing"), info: undefined }).pipe(Effect.flatMap(readInitial)))
          .text,
      ).toBe("")
    }).pipe(Effect.provide(layer(() => [explore]))),
  )
})
