import fs from "fs/promises"
import os from "os"
import path from "path"
import { expect } from "bun:test"
import { Effect, Layer, Schedule } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { MarketplaceService } from "@opencode/core/marketplace/service"
import { MarketplaceRegistry } from "@opencode/core/marketplace/registry"
import { testEffect } from "./lib/effect"
import { tempLocationLayer } from "./fixture/location"
import { emptyCredentialNode, emptyWellknownNode } from "./fixture/config-nodes"
import { Credential } from "@opencode/core/credential"
import { WellKnown } from "@opencode/core/wellknown"
import { withEnv } from "./fixture/env"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "./fixture/tmpdir"

const layer = AppNodeBuilder.build(LayerNode.group([Config.node, MarketplaceRegistry.node, MarketplaceService.node]), [
  Location.node.replace(tempLocationLayer),
  Config.node.replace(Config.configured({ system: false, project: false })),
  Global.node.replace(
    Layer.unwrap(
      Effect.gen(function* () {
          const tmp = yield* tmpdirScoped().pipe(Effect.orDie)
        return Global.layerWith({
          home: tmp.path,
          config: path.join(tmp.path, "config"),
          cache: path.join(tmp.path, "cache"),
          state: path.join(tmp.path, "state"),
        })
      }),
    ),
  ),
  Credential.node.replace(emptyCredentialNode),
  WellKnown.node.replace(emptyWellknownNode),
])
const it = testEffect(layer)

it.live("keeps private catalog credentials secret through plan and materialization", () =>
  withEnv({ MARKETPLACE_TEST_TOKEN: "private-token-value" }, () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const server = Bun.serve({
          port: 0,
          fetch(request) {
            if (request.headers.get("private-token") !== "private-token-value")
              return new Response("unauthorized", { status: 401 })
            const pathname = new URL(request.url).pathname
            if (pathname === "/catalog.json")
              return Response.json({
                schema: "opencode.marketplace/v1",
                id: "private",
                name: "Private",
                items: [
                  {
                    id: "skill",
                    name: "Skill",
                    description: "Private skill",
                    kind: "skill",
                    version: "1.0.0",
                    install: { skills: { items: [{ id: "skill", name: "skill", url: "./skill.md" }] } },
                  },
                ],
              })
            if (pathname === "/skill.md")
              return new Response("---\nname: skill\ndescription: Private skill\n---\nPrivate content")
            return new Response("not found", { status: 404 })
          },
        })
        return server
      }),
      (server) =>
        Effect.gen(function* () {
          const marketplace = yield* MarketplaceService.Service
          const added = yield* marketplace.sourceAdd({
            expectedRevision: 0,
            url: new URL("catalog.json", server.url).href,
            headerEnv: { "PRIVATE-TOKEN": "MARKETPLACE_TEST_TOKEN" },
            trust: "private",
          })
          if (!added.ok) throw new Error(added.message)
          expect(JSON.stringify(added)).not.toContain("private-token-value")
          const listing = added.view.listings[0]
          if (!listing) throw new Error("Missing private listing")
          const plan = yield* marketplace.plan(listing.key)
          if (!plan.ok) throw new Error(plan.message)
          const result = yield* marketplace.install({
            planId: plan.plan_id,
            expectedRevision: plan.revision,
            acceptUntrusted: true,
          })
          expect(result.ok).toBe(true)
          expect(JSON.stringify(result)).not.toContain("private-token-value")
          const registry = yield* MarketplaceRegistry.Service
          expect(JSON.stringify(yield* registry.read())).not.toContain("private-token-value")
        }),
      (server) => Effect.promise(async () => void (await server.stop(true))),
    ),
  ),
)

it.live("applies exactly the materialized one-time plan that was reviewed", () =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-marketplace-service-"))),
    (root) =>
      Effect.gen(function* () {
        const marketplace = yield* MarketplaceService.Service
        const registry = yield* MarketplaceRegistry.Service
        const config = yield* Config.Service
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
        const visible = config.entries().pipe(
          Effect.map((entries) => Config.latest(entries, "agents")?.review?.system),
          Effect.repeat({ until: (value) => value === "reviewed", schedule: Schedule.spaced("5 millis") }),
          Effect.timeout("5 seconds"),
        )
        expect(yield* visible).toBe("reviewed")

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

it.live("projects package, skill and MCP toggles into V2 config", () =>
  Effect.gen(function* () {
    const registry = yield* MarketplaceRegistry.Service
    const marketplace = yield* MarketplaceService.Service
    const config = yield* Config.Service
    const state = yield* registry.read()
    const plan = {
      skills: { items: [{ id: "review", name: "review", path: "/tmp/review-skill" }] },
      mcp: { docs: { type: "remote", url: "https://example.test/mcp" } },
    }
    yield* registry.replace({
      revision: state.revision,
      installed: {
        "source:catalog:item": {
          source: "source",
          catalog: "catalog",
          item: "item",
          name: "Item",
          kind: "bundle",
          version: "1.0.0",
          fingerprint: "fingerprint",
          installed_at: "2026-01-01",
          updated_at: "2026-01-01",
          plan,
          materialized_plan: plan,
          active_plan: plan,
          receipt: {},
        },
      },
    })
    const read = config.entries().pipe(
      Effect.map((entries) => ({
        skills: entries.flatMap((entry) => (entry.type === "document" ? (entry.info.skills ?? []) : [])),
        mcp: entries.flatMap((entry) =>
          entry.type === "document" ? Object.values(entry.info.mcp?.servers ?? {}) : [],
        ),
      })),
    )
    const wait = (predicate: (value: Effect.Success<typeof read>) => boolean) =>
      read.pipe(Effect.repeat({ until: predicate, schedule: Schedule.spaced("5 millis") }), Effect.timeout("5 seconds"))
    yield* wait((value) => value.skills.includes("/tmp/review-skill") && value.mcp.some((item) => !item.disabled))
    const skill = yield* marketplace.toggle({
      key: "source:catalog:item",
      component: "skill",
      id: "review",
      enabled: false,
      expectedRevision: (yield* registry.read()).revision ?? 0,
    })
    expect(skill.ok).toBe(true)
    yield* wait((value) => !value.skills.includes("/tmp/review-skill"))
    const mcp = yield* marketplace.toggle({
      key: "source:catalog:item",
      component: "mcp",
      id: "docs",
      enabled: false,
      expectedRevision: (yield* registry.read()).revision ?? 0,
    })
    expect(mcp.ok).toBe(true)
    yield* wait((value) => value.mcp.some((item) => item.disabled === true))
  }),
)

it.live("installs a repo-local Codex marketplace plugin through the common immutable pipeline", () =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-marketplace-service-"))),
    (root) =>
      Effect.gen(function* () {
        const marketplace = yield* MarketplaceService.Service
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
          await fs.mkdir(path.join(plugin, "skills", "release"), { recursive: true })
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
          await fs.writeFile(
            path.join(plugin, "skills", "release", "SKILL.md"),
            `---\nname: release\ndescription: Prepare releases\n---\nPrepare a release in ${root}.`,
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
        expect(planned.summary).toBe("2 skills")
        const materialized = yield* registry.read()
        const cacheRoot = (yield* marketplace.get()).cache.root
        const materializations = yield* Effect.promise(() =>
          fs.readdir(path.join(cacheRoot, "materialized", "sha256"), { recursive: true }),
        )
        const files = yield* Effect.promise(() =>
          Promise.all(
            materializations
              .filter((file) => file.endsWith("SKILL.md"))
              .map(async (file) => ({
                file,
                content: await fs.readFile(path.join(cacheRoot, "materialized", "sha256", file), "utf8"),
              })),
          ),
        )
        const selected = files.find((item) => item.content.includes(`Prepare a release in ${root}.`))
        if (!selected) throw new Error("Expected this plan's materialized skill")
        const tampered = path.join(cacheRoot, "materialized", "sha256", selected.file)
        const original = yield* Effect.promise(() => fs.readFile(tampered))
        yield* Effect.promise(() => fs.writeFile(tampered, "changed after review"))
        const rejected = yield* marketplace.install({
          planId: planned.plan_id,
          expectedRevision: planned.revision,
          acceptUntrusted: true,
        })
        expect(rejected).toMatchObject({ ok: false, reason: "materialization" })
        expect((yield* registry.read()).revision).toBe(materialized.revision)
        yield* Effect.promise(() => fs.writeFile(tampered, original))
        const applied = yield* marketplace.install({
          planId: planned.plan_id,
          expectedRevision: added.view.state.revision ?? 0,
          acceptUntrusted: true,
        })
        if (!applied.ok) throw new Error(applied.message)
        expect(
          applied.view.state.installed?.[listing.key]?.plan.skills?.items?.map((skill) => skill.name).toSorted(),
        ).toEqual(["release", "review"])
        expect(
          applied.view.state.installed?.[listing.key]?.plan.skills?.items?.some((skill) => skill.path || skill.url),
        ).toBe(false)

        const installed = (yield* registry.read()).installed?.[listing.key]
        const skills = installed?.materialized_plan?.skills?.items
        expect(skills?.map((skill) => skill.name).toSorted()).toEqual(["release", "review"])
        const review = skills?.find((skill) => skill.name === "review")
        expect(review?.path).toBeDefined()
        expect(yield* Effect.tryPromise(() => fs.readFile(path.join(review!.path!, "SKILL.md"), "utf8"))).toContain(
          "Review the current changes",
        )

        const toggled = yield* marketplace.toggle({
          key: listing.key,
          component: "skill",
          id: review!.id,
          enabled: false,
          expectedRevision: (yield* registry.read()).revision ?? 0,
        })
        if (!toggled.ok) throw new Error(toggled.message)
        const disabled = (yield* registry.read()).installed?.[listing.key]
        expect(disabled?.disabled_skills).toEqual([review!.id])
        expect(disabled?.active_plan?.skills?.items?.map((skill) => skill.name)).toEqual(["release"])

        const current = yield* registry.read()
        yield* registry.replace({ revision: current.revision, sources: [], installed: {} })
      }),
    (root) => Effect.tryPromise(() => fs.rm(root, { recursive: true, force: true })),
  ),
)
