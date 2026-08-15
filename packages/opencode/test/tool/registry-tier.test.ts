import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([ToolRegistry.node, Agent.node]), [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ]),
)

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.registry tier roster", () => {
  it.instance("minimal tier exposes exactly the core roster", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("qwen3.5-4b"),
        agent: yield* agents.defaultInfo(),
        tier: "minimal",
      })

      expect(tools.map((tool) => tool.id).toSorted()).toEqual([
        "bash",
        "edit",
        "glob",
        "grep",
        "invalid",
        "read",
        "todowrite",
        "write",
      ])
    }),
  )

  it.instance("default tier keeps the standard roster minus apply_patch", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("qwen3.6-35b-a3b"),
        agent: yield* agents.defaultInfo(),
        tier: "default",
      })
      const ids = tools.map((tool) => tool.id)

      expect(ids).not.toContain("apply_patch")
      for (const id of ["bash", "edit", "write", "task", "skill", "webfetch", "todowrite"]) {
        expect(ids).toContain(id)
      }
    }),
  )

  it.instance("default tier never swaps edit/write for apply_patch on gpt ids", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("gpt-5.2"),
        agent: yield* agents.defaultInfo(),
        tier: "default",
      })
      const ids = tools.map((tool) => tool.id)

      expect(ids).not.toContain("apply_patch")
      expect(ids).toContain("edit")
      expect(ids).toContain("write")
    }),
  )

  it.instance("vendor tier keeps the existing roster behavior", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const agent = yield* agents.defaultInfo()
      const without = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("gpt-5.2"),
        agent,
      })
      const vendor = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("gpt-5.2"),
        agent,
        tier: "vendor",
      })

      expect(vendor.map((tool) => tool.id).toSorted()).toEqual(without.map((tool) => tool.id).toSorted())
      expect(vendor.map((tool) => tool.id)).toContain("apply_patch")
      expect(vendor.map((tool) => tool.id)).not.toContain("edit")
    }),
  )
})
