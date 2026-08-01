import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Skill } from "@/skill"
import * as MarketplaceRegistry from "@/marketplace/registry"
import { InstanceStore } from "@/project/instance-store"
import { provideTmpdirInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const layer = Layer.mergeAll(
  LayerNode.compile(LayerNode.group([Config.node, Skill.node, MarketplaceRegistry.node])),
  LayerNode.compile(CrossSpawnSpawner.node),
  testInstanceStoreLayer,
)
const it = testEffect(layer)

it.live("rebuilds every marketplace runtime projection after the instance is disposed", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const registry = yield* MarketplaceRegistry.Service
        const config = yield* Config.Service
        const skill = yield* Skill.Service
        const instances = yield* InstanceStore.Service
        const before = yield* registry.read()
        const skillRoot = path.join(dir, "marketplace-skill")
        const instruction = path.join(dir, "marketplace-instruction.md")
        const plugin = path.join(dir, "marketplace-plugin.ts")
        yield* Effect.tryPromise(async () => {
          await fs.mkdir(skillRoot, { recursive: true })
          await fs.writeFile(
            path.join(skillRoot, "SKILL.md"),
            "---\nname: marketplace-review\ndescription: Review through Marketplace\n---\nReview the diff.",
          )
          await fs.writeFile(instruction, "Marketplace instruction")
          await fs.writeFile(plugin, "export default async () => ({})")
        })

        expect((yield* skill.all()).some((item) => item.name === "marketplace-review")).toBe(false)
        const plan = {
          plugins: [pathToFileURL(plugin).href],
          skills: { paths: [skillRoot] },
          agents: { marketplace_agent: { description: "Marketplace agent", mode: "subagent" } },
          commands: { marketplace_command: { template: "Run marketplace command" } },
          mcp: { marketplace_docs: { type: "remote", url: "https://example.test/mcp", enabled: false } },
          instructions: [instruction],
        }
        const stored = yield* registry.replace({
          ...before,
          installed: {
            ...(before.installed ?? {}),
            "source:catalog:bundle": {
              source: "source",
              catalog: "catalog",
              item: "bundle",
              name: "Bundle",
              kind: "bundle",
              version: "1.0.0",
              fingerprint: "bundle-v1",
              installed_at: "2026-07-30T00:00:00.000Z",
              updated_at: "2026-07-30T00:00:00.000Z",
              plan,
              active_plan: plan,
              receipt: {},
              enabled: true,
            },
          },
        })
        yield* config.invalidate()
        yield* instances.disposeDirectory(dir)

        const effective = yield* config.get()
        expect(effective.marketplace?.revision).toBe(stored.state.revision)
        expect(effective.plugin).toContain(pathToFileURL(plugin).href)
        expect(effective.plugin_origins?.map((item) => item.spec)).toContain(pathToFileURL(plugin).href)
        expect(effective.agent?.marketplace_agent).toEqual(
          expect.objectContaining({ description: "Marketplace agent", mode: "subagent" }),
        )
        expect(effective.command?.marketplace_command).toEqual({ template: "Run marketplace command" })
        expect(effective.mcp?.marketplace_docs).toEqual(
          expect.objectContaining({ type: "remote", url: "https://example.test/mcp", enabled: false }),
        )
        expect(effective.instructions).toContain(instruction)
        expect((yield* skill.all()).map((item) => item.name)).toContain("marketplace-review")

        const current = yield* registry.read()
        yield* registry.replace({ ...before, revision: current.revision }).pipe(Effect.orDie)
        yield* config.invalidate()
        yield* instances.disposeDirectory(dir)
      }),
    { git: true },
  ),
)
