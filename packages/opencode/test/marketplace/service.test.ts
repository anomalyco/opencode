import fs from "fs/promises"
import os from "os"
import path from "path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@/config/config"
import { MarketplaceService, MarketplaceServiceNode } from "@/marketplace/service"
import * as MarketplaceRegistry from "@/marketplace/registry"
import { testEffect } from "../lib/effect"

const layer = LayerNode.compile(LayerNode.group([Config.node, MarketplaceRegistry.node, MarketplaceServiceNode]))
const it = testEffect(layer)

it.live("applies exactly the materialized one-time plan that was reviewed", () =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-marketplace-service-"))),
    (root) =>
      Effect.gen(function* () {
        const marketplace = yield* MarketplaceService
        const registry = yield* MarketplaceRegistry.Service
        const before = yield* registry.read()
        if (before.sources?.length || Object.keys(before.installed ?? {}).length) {
          yield* registry.replace({ revision: before.revision, sources: [], installed: {} })
        }
        const empty = yield* registry.read()
        const catalog = path.join(root, "marketplace.json")
        const writeCatalog = (template: string) =>
          fs.writeFile(
            catalog,
            JSON.stringify({
              schema: "opencode.marketplace/v1",
              id: "test",
              name: "Test",
              items: [
                {
                  id: "review",
                  name: "Review",
                  description: "Review changes",
                  kind: "agent",
                  version: "1.0.0",
                  install: { agents: { review: { description: "Review", prompt: template } } },
                },
              ],
            }),
          )
        yield* Effect.tryPromise(() => writeCatalog("reviewed"))
        const added = yield* marketplace.sourceAdd({
          expectedRevision: empty.revision ?? 0,
          url: catalog,
          trust: "private",
        })
        if (!added.ok) throw new Error(added.message)
        const listing = added.view.listings[0]
        if (!listing) throw new Error("Expected Marketplace listing")
        const planned = yield* marketplace.plan(listing.key)
        if (!planned.ok) throw new Error(planned.message)

        yield* Effect.tryPromise(() => writeCatalog("changed-after-plan"))
        const applied = yield* marketplace.install({
          planId: planned.plan_id,
          expectedRevision: added.view.state.revision ?? 0,
          acceptUntrusted: true,
        })
        expect(applied.ok).toBe(true)
        expect((yield* registry.read()).installed?.[listing.key]?.plan.agents?.review?.prompt).toBe("reviewed")

        const replay = yield* marketplace.install({
          planId: planned.plan_id,
          expectedRevision: (yield* registry.read()).revision ?? 0,
          acceptUntrusted: true,
        })
        expect(replay).toMatchObject({ ok: false, reason: "plan_consumed" })

        const current = yield* registry.read()
        yield* registry.replace({ revision: current.revision, sources: [], installed: {} })
      }),
    (root) => Effect.tryPromise(() => fs.rm(root, { recursive: true, force: true })),
  ),
)

it.live("installs a repo-local Codex marketplace plugin through the common immutable pipeline", () =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-marketplace-service-"))),
    (root) =>
      Effect.gen(function* () {
        const marketplace = yield* MarketplaceService
        const registry = yield* MarketplaceRegistry.Service
        const before = yield* registry.read()
        if (before.sources?.length || Object.keys(before.installed ?? {}).length) {
          yield* registry.replace({ revision: before.revision, sources: [], installed: {} })
        }
        const empty = yield* registry.read()
        const plugin = path.join(root, "plugins", "review")
        yield* Effect.tryPromise(async () => {
          await fs.mkdir(path.join(root, ".agents", "plugins"), { recursive: true })
          await fs.mkdir(path.join(plugin, ".codex-plugin"), { recursive: true })
          await fs.mkdir(path.join(plugin, "skills", "review"), { recursive: true })
          await fs.writeFile(
            path.join(root, ".agents", "plugins", "marketplace.json"),
            JSON.stringify({
              name: "team",
              plugins: [
                {
                  name: "review",
                  source: { source: "local", path: "./plugins/review" },
                  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
                  category: "Developer tools",
                },
              ],
            }),
          )
          await fs.writeFile(
            path.join(plugin, ".codex-plugin", "plugin.json"),
            JSON.stringify({
              name: "review",
              version: "1.0.0",
              description: "Review changes",
              skills: "./skills/",
            }),
          )
          await fs.writeFile(
            path.join(plugin, "skills", "review", "SKILL.md"),
            "---\nname: review\ndescription: Review changes\n---\nReview the current changes.",
          )
        })

        const added = yield* marketplace.sourceAdd({
          expectedRevision: empty.revision ?? 0,
          url: root,
          trust: "private",
          format: "codex",
        })
        if (!added.ok) throw new Error(added.message)
        const listing = added.view.listings[0]
        if (!listing) throw new Error("Expected adapted Codex listing")
        const planned = yield* marketplace.plan(listing.key)
        if (!planned.ok) throw new Error(planned.message)
        const applied = yield* marketplace.install({
          planId: planned.plan_id,
          expectedRevision: added.view.state.revision ?? 0,
          acceptUntrusted: true,
        })
        if (!applied.ok) throw new Error(applied.message)

        const installed = (yield* registry.read()).installed?.[listing.key]
        const skillRoot = installed?.materialized_plan?.skills?.paths?.[0]
        expect(skillRoot).toBeDefined()
        expect(yield* Effect.tryPromise(() => fs.readFile(path.join(skillRoot!, "SKILL.md"), "utf8"))).toContain(
          "Review the current changes",
        )

        const current = yield* registry.read()
        yield* registry.replace({ revision: current.revision, sources: [], installed: {} })
      }),
    (root) => Effect.tryPromise(() => fs.rm(root, { recursive: true, force: true })),
  ),
)
