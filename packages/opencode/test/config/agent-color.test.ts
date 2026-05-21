import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Config.defaultLayer, AgentSvc.defaultLayer, CrossSpawnSpawner.defaultLayer))

it.instance(
  "agent color parsed from project config",
  () =>
    Effect.gen(function* () {
      const cfg = yield* Config.Service.use((svc) => svc.get())
      expect(cfg.agent?.["build"]?.color).toBe("#FFA500")
      expect(cfg.agent?.["plan"]?.color).toBe("primary")
    }),
  {
    git: true,
    config: {
      agent: {
        build: { color: "#FFA500" },
        plan: { color: "primary" },
      },
    },
  },
)

it.instance(
  "Agent.get includes color from config",
  () =>
    Effect.gen(function* () {
      const plan = yield* AgentSvc.Service.use((svc) => svc.get("plan"))
      expect(plan?.color).toBe("#A855F7")
      const build = yield* AgentSvc.Service.use((svc) => svc.get("build"))
      expect(build?.color).toBe("accent")
    }),
  {
    git: true,
    config: {
      agent: {
        plan: { color: "#A855F7" },
        build: { color: "accent" },
      },
    },
  },
)
