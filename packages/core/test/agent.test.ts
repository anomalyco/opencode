import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const it = testEffect(AppNodeBuilder.build(AgentV2.node))

describe("AgentV2", () => {
  it.effect("starts without agents", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service

      expect(yield* agent.all()).toEqual([])
      expect(yield* agent.get(AgentV2.ID.make("build"))).toBeUndefined()
    }),
  )

  it.effect("materializes replayable agent transforms", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = "Reviews code"
          info.mode = "subagent"
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, description: "Reviews code", mode: "subagent" })
      expect((yield* agent.all()).map((info) => info.id)).toEqual([id])
    }),
  )

  it.effect("rebuilds state when a transform is replaced", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      let description = "Old description"
      let hidden = true
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = description
          info.hidden = hidden
        }),
      )
      description = "New description"
      hidden = false
      yield* agent.reload()

      expect(yield* agent.get(id)).toMatchObject({ description: "New description", hidden: false })
    }),
  )

  it.effect("removes a transform when its scope closes", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("scoped")
      const scope = yield* Scope.make()
      yield* agent.transform((editor) => editor.update(id, () => {})).pipe(Scope.provide(scope))
      expect(yield* agent.get(id)).toBeDefined()

      yield* Scope.close(scope, Exit.void)
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies direct agent updates", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("build")

      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.mode = "primary"
          info.hidden = true
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, mode: "primary", hidden: true })
    }),
  )

  it.effect("creates agents with runtime defaults and supports direct removal", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("custom")

      yield* agent.transform((editor) => editor.update(id, () => {}))
      expect(yield* agent.get(id)).toEqual(AgentV2.Info.empty(id))

      yield* agent.transform((editor) => editor.remove(id))
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("registers workflow entrypoints and keeps orchestration roles hidden", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const agents = yield* agent.all()
      expect(agents.map((item) => String(item.id)).sort()).toEqual([
        "build",
        "compaction",
        "council",
        "council-debater",
        "council-perspective",
        "council-planner",
        "council-synthesizer",
        "explore",
        "general",
        "heavy",
        "heavy-planner",
        "heavy-reader",
        "heavy-synthesizer",
        "heavy-writer",
        "plan",
        "research",
        "research-assessor",
        "research-critic",
        "research-planner",
        "research-reader",
        "research-synthesizer",
        "research-writer",
        "summary",
        "title",
      ])
      expect((yield* agent.get(AgentV2.ID.make("heavy")))?.permissions).toEqual([
        { action: "*", resource: "*", effect: "deny" },
        { action: "heavy_run", resource: "*", effect: "allow" },
      ])
      expect((yield* agent.get(AgentV2.ID.make("heavy")))?.steps).toBe(3)
      expect((yield* agent.get(AgentV2.ID.make("council")))?.permissions).toEqual([
        { action: "*", resource: "*", effect: "deny" },
        { action: "council_run", resource: "*", effect: "allow" },
      ])
      expect((yield* agent.get(AgentV2.ID.make("council")))?.steps).toBe(3)
      expect((yield* agent.get(AgentV2.ID.make("research")))?.permissions).toEqual([
        { action: "*", resource: "*", effect: "deny" },
        { action: "research_run", resource: "*", effect: "allow" },
      ])
      expect((yield* agent.get(AgentV2.ID.make("research")))?.steps).toBe(3)
      const planner = yield* agent.get(AgentV2.ID.make("heavy-planner"))
      const perspective = yield* agent.get(AgentV2.ID.make("council-perspective"))
      const synthesizer = yield* agent.get(AgentV2.ID.make("heavy-synthesizer"))
      const writer = yield* agent.get(AgentV2.ID.make("heavy-writer"))
      expect(writer?.hidden).toBe(true)
      const workflows = ["heavy_run", "council_run", "workflow_report"]
      workflows.forEach((workflow) => {
        expect(PermissionV2.evaluate(workflow, "*", planner?.permissions ?? []).effect).toBe("allow")
        expect(PermissionV2.evaluate(workflow, "*", perspective?.permissions ?? []).effect).toBe("allow")
        expect(PermissionV2.evaluate(workflow, "*", writer?.permissions ?? []).effect).toBe("allow")
      })
      expect(PermissionV2.evaluate("workflow_read_reports", "*", planner?.permissions ?? []).effect).toBe("deny")
      expect(PermissionV2.evaluate("workflow_read_reports", "*", perspective?.permissions ?? []).effect).toBe("allow")
      expect(PermissionV2.evaluate("read", "/project/src/index.ts", perspective?.permissions ?? []).effect).toBe(
        "allow",
      )
      expect(
        PermissionV2.evaluate(
          "read",
          "/project/.opencode/reports/old-run/stages/evidence.md",
          perspective?.permissions ?? [],
        ).effect,
      ).toBe("deny")
      expect(synthesizer?.steps).toBe(32)
      expect(PermissionV2.evaluate("websearch", "*", planner?.permissions ?? []).effect).toBe("deny")
      expect(PermissionV2.evaluate("read", "*", planner?.permissions ?? []).effect).toBe("deny")
      const researchPlanner = yield* agent.get(AgentV2.ID.make("research-planner"))
      const researchReader = yield* agent.get(AgentV2.ID.make("research-reader"))
      const researchCritic = yield* agent.get(AgentV2.ID.make("research-critic"))
      const researchAssessor = yield* agent.get(AgentV2.ID.make("research-assessor"))
      const researchSynthesizer = yield* agent.get(AgentV2.ID.make("research-synthesizer"))
      const researchWriter = yield* agent.get(AgentV2.ID.make("research-writer"))
      expect(PermissionV2.evaluate("research_run", "*", researchReader?.permissions ?? []).effect).toBe("deny")
      expect(PermissionV2.evaluate("council_run", "*", researchReader?.permissions ?? []).effect).toBe("deny")
      expect(PermissionV2.evaluate("websearch", "*", researchReader?.permissions ?? []).effect).toBe("allow")
      expect(
        PermissionV2.evaluate(
          "read",
          "/project/.opencode/reports/old-run/stages/evidence.md",
          researchReader?.permissions ?? [],
        ).effect,
      ).toBe("deny")
      expect(PermissionV2.evaluate("websearch", "*", researchCritic?.permissions ?? []).effect).toBe("deny")
      expect(PermissionV2.evaluate("webfetch", "*", researchSynthesizer?.permissions ?? []).effect).toBe("deny")
      expect(PermissionV2.evaluate("read", "*", researchSynthesizer?.permissions ?? []).effect).toBe("deny")
      expect(PermissionV2.evaluate("workflow_read_reports", "*", researchCritic?.permissions ?? []).effect).toBe(
        "allow",
      )
      expect(PermissionV2.evaluate("workflow_read_reports", "*", researchSynthesizer?.permissions ?? []).effect).toBe(
        "allow",
      )
      expect(PermissionV2.evaluate("websearch", "*", researchPlanner?.permissions ?? []).effect).toBe("deny")
      expect(PermissionV2.evaluate("workflow_read_reports", "*", researchPlanner?.permissions ?? []).effect).toBe(
        "allow",
      )
      expect(PermissionV2.evaluate("workflow_read_reports", "*", researchAssessor?.permissions ?? []).effect).toBe(
        "allow",
      )
      expect(PermissionV2.evaluate("research_run", "*", researchWriter?.permissions ?? []).effect).toBe("deny")
      expect(
        PermissionV2.evaluate(
          "read",
          "/project/.opencode/reports/old-run/stages/evidence.md",
          researchWriter?.permissions ?? [],
        ).effect,
      ).toBe("deny")
    }),
  )
})
