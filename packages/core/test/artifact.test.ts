import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Artifact } from "@opencode/core/artifact"
import { ArtifactTable } from "@opencode/core/artifact/sql"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import artifactMigration from "@opencode/core/database/migration/20261125001949_artifact"
import { Flag } from "@opencode/core/flag"
import { Image } from "@opencode/core/image"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PluginHost } from "@opencode/core/plugin/host"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { ArtifactTools } from "@opencode/core/tool/plugin/artifact"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { AbsolutePath } from "@opencode/schema/schema"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const toolPaths = [
  "opencode.artifact_create",
  "opencode.artifact_read",
  "opencode.artifact_update",
  "opencode.artifact_delete",
]

const buildLayer = (artifactsEnabled: boolean, dir: string) => {
  const entries = artifactsEnabled
    ? [
        new Document({
          type: "document",
          info: new Info({
            experimental: new ConfigExperimental.Info({ artifacts: true }),
          }),
        }),
      ]
    : []
  const ref = Location.Ref.make({ directory: AbsolutePath.make(dir) })
  return AppNodeBuilder.build(
    LayerNode.group([
      Artifact.node,
      Config.node,
      Database.node,
      Flag.node,
      KV.node,
      Global.node,
      Location.node,
      Permission.node,
      Session.node,
      Tool.node,
    ]),
    [
      Config.node.replace(Config.testLayer(entries)),
      Global.node.replace(Global.layerWith({ data: path.join(dir, ".data") })),
      Image.node.replace(imagePassthrough),
      Location.node.replace(Location.boundNode(ref)),
      Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
    ],
  )
}

const callCodeMode = (registry: Tool.Interface, sessionID: Session.ID, name: string, input: unknown) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: {
      type: "tool-call",
      id: `call-${name}`,
      name: "execute",
      input: { code: `return await tools.opencode.${name}(${JSON.stringify(input)})` },
    },
  }).pipe(
    Effect.map((result) => {
      if (result.status !== "completed") {
        throw new Error(`Tool ${name} failed: ${JSON.stringify(result.error)}`)
      }
      return JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "")
    }),
  )

const it = testEffect(Layer.empty)

describe("experimental.artifacts service and tools", () => {
  it.live("stays disabled and hides artifact tools when experimental.artifacts is unset", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-off-")).path
      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const registry = yield* Tool.Service
        expect(yield* artifacts.enabled()).toBe(false)
        expect(
          yield* artifacts.create({ title: "Draft", files: { "index.html": "<h1>hi</h1>" } }).pipe(Effect.flip),
        ).toBeInstanceOf(Artifact.DisabledError)

        yield* registerToolPlugin(ArtifactTools.Plugin, {
          event: { subscribe: () => Stream.never },
        })
        const snap = yield* registry.snapshot()
        const listed = snap.codeModeCatalog ? codeModeListings(snap.codeModeCatalog).map((item) => item.path) : []
        for (const name of toolPaths) {
          expect(listed).not.toContain(name)
        }
      }).pipe(Effect.provide(buildLayer(false, dir)))
    }),
  )

  it.live("registers custom providers, routes overrides, and runs the 4 CRUD tools", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-on-")).path

      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const registry = yield* Tool.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(dir) }),
        })

        const remoteStore = new Map<Artifact.ID, Record<string, Uint8Array>>()
        yield* artifacts.transform((editor) => {
          editor.add({
            id: Artifact.ProviderID.make("cloudflare"),
            name: "Cloudflare",
            capabilities: ["static", "server-code", "sqlite", "durable-objects"],
            prompt: "Artifacts deploy to Cloudflare with SQLite and Durable Objects.",
            create: (input) =>
              Effect.sync(() => {
                remoteStore.set(input.id, { ...input.files })
                return { url: `https://cf.example.test/${input.id}/` }
              }),
            read: (id) => Effect.sync(() => remoteStore.get(id) ?? {}),
            update: (id, input) =>
              Effect.sync(() => {
                remoteStore.set(id, { ...input.files })
                return { url: `https://cf.example.test/${id}/` }
              }),
            delete: (id) =>
              Effect.sync(() => {
                remoteStore.delete(id)
              }),
          })
          editor.default.set(Artifact.ProviderID.make("cloudflare"))
        })

        yield* registerToolPlugin(ArtifactTools.Plugin, {
          event: { subscribe: () => Stream.never },
        })
        const snap = yield* registry.snapshot()
        const listings = snap.codeModeCatalog ? codeModeListings(snap.codeModeCatalog) : []
        expect(listings.map((item) => item.path)).toEqual(expect.arrayContaining(toolPaths))
        const rawTools = yield* registry.list()
        const createTool = rawTools.find((item) => item.id === "opencode_artifact_create")
        expect(createTool?.description).toContain(
          "Default provider (cloudflare [static, server-code, sqlite, durable-objects]): Artifacts deploy to Cloudflare with SQLite and Durable Objects.",
        )
        expect(createTool?.description).toContain("Other active providers (pass provider to override): local [static].")

        const createdInfo = (yield* callCodeMode(registry, session.id, "artifact_create", {
          title: "Flamegraph report",
          files: {
            "index.html": "<!doctype html><script src='./assets/app.js'></script>",
            "assets/app.js": "console.log('v1')",
          },
        })) as Artifact.Info

        expect(createdInfo).toMatchObject({
          provider: "cloudflare",
          sessionID: session.id,
          title: "Flamegraph report",
          entry: "index.html",
          url: `https://cf.example.test/${createdInfo.id}/`,
        })

        const content = (yield* callCodeMode(registry, session.id, "artifact_read", {
          id: createdInfo.id,
        })) as Artifact.Content
        expect(Object.keys(content.files).toSorted()).toEqual(["assets/app.js", "index.html"])
        expect(content.files["assets/app.js"]).toBe("console.log('v1')")

        // Per-request provider override ("local") stores independently of default ("cloudflare")
        const localInfo = (yield* callCodeMode(registry, session.id, "artifact_create", {
          title: "Local scratch",
          files: { "index.html": "<h1>Notes</h1>" },
          provider: "local",
        })) as Artifact.Info
        expect(localInfo.provider).toBe(Artifact.LocalProviderID)

        // Update replaces files at the same ID and URL
        const updatedInfo = (yield* callCodeMode(registry, session.id, "artifact_update", {
          id: createdInfo.id,
          files: { "index.html": "<h1>v2</h1>" },
        })) as Artifact.Info
        expect(updatedInfo.url).toBe(createdInfo.url)

        yield* callCodeMode(registry, session.id, "artifact_delete", { id: createdInfo.id })
        expect(yield* artifacts.get(createdInfo.id).pipe(Effect.flip)).toBeInstanceOf(Artifact.NotFoundError)

        // Reject path traversal
        const traversal = yield* artifacts
          .create({
            title: "Bad path",
            files: { "../escape.html": "nope" },
          })
          .pipe(Effect.flip)
        expect(traversal).toBeInstanceOf(Artifact.InvalidError)
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )
  it.live("saves the last published files and reads them when the host has no live copy", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-snapshot-")).path

      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const remote = new Map<Artifact.ID, Readonly<Record<string, Uint8Array>>>()
        const failDelete = { value: false }
        const host = (id: string, live: boolean): Artifact.ProviderImplementation => ({
          id: Artifact.ProviderID.make(id),
          name: id,
          capabilities: ["static"],
          prompt: id,
          create: (input) => Effect.sync(() => void remote.set(input.id, input.files)).pipe(Effect.as({})),
          update: (artifactID, input) =>
            Effect.sync(() => void remote.set(artifactID, input.files)).pipe(Effect.as({})),
          ...(live ? { read: (artifactID: Artifact.ID) => Effect.sync(() => remote.get(artifactID) ?? {}) } : {}),
          delete: (artifactID) =>
            failDelete.value
              ? Effect.fail(new Error("host is down"))
              : Effect.sync(() => void remote.delete(artifactID)),
        })
        yield* artifacts.transform((editor) => {
          editor.add(host("bucket", false))
          editor.add(host("console", true))
        })

        // A write-only host is read back from the snapshot, which inlines text up to its limits.
        const page = yield* artifacts.create({
          title: "Report",
          provider: Artifact.ProviderID.make("bucket"),
          files: {
            "index.html": "<h1>Report</h1>",
            "a.txt": "a".repeat(64 * 1024),
            "b.txt": "b".repeat(64 * 1024),
            "c.txt": "c".repeat(64 * 1024),
            "d.txt": "d".repeat(64 * 1024),
            "big.txt": "x".repeat(65 * 1024),
          },
        })
        const snapshot = yield* artifacts.get(page.id)
        expect(snapshot.source).toBe("snapshot")
        expect(Object.keys(snapshot.files)).toEqual(["index.html", "a.txt", "b.txt", "c.txt"])
        expect(snapshot.omitted).toEqual({ "big.txt": 65 * 1024, "d.txt": 64 * 1024 })

        // A host others edit is read live, and the snapshot follows it.
        const shared = yield* artifacts.create({
          title: "Shared",
          provider: Artifact.ProviderID.make("console"),
          files: { "index.html": "<h1>v1</h1>" },
        })
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        remote.set(shared.id, { "index.html": new TextEncoder().encode("<h1>edited</h1>"), "logo.png": png })
        const live = yield* artifacts.get(shared.id)
        expect(live).toMatchObject({
          source: "live",
          files: { "index.html": "<h1>edited</h1>" },
          omitted: { "logo.png": 8 },
        })
        expect(
          new Uint8Array(
            yield* Effect.promise(() => fs.readFile(path.join(dir, ".data/artifacts", shared.id, "logo.png"))),
          ),
        ).toEqual(png)

        yield* artifacts.transform((editor) => editor.remove(Artifact.ProviderID.make("console")))
        expect(yield* artifacts.get(shared.id)).toMatchObject({
          source: "snapshot",
          files: { "index.html": "<h1>edited</h1>" },
          omitted: { "logo.png": 8 },
        })

        // Deleting needs the host: without it, or when it fails, the record stays.
        expect(yield* artifacts.remove(shared.id).pipe(Effect.flip)).toBeInstanceOf(Artifact.ProviderNotFoundError)
        expect((yield* artifacts.info(shared.id)).id).toBe(shared.id)
        failDelete.value = true
        expect(yield* artifacts.remove(page.id).pipe(Effect.flip)).toBeInstanceOf(Artifact.ProviderError)
        expect((yield* artifacts.list()).map((item) => item.id).toSorted()).toEqual([page.id, shared.id].toSorted())
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )

  it.live("lists this project's artifacts, newest update first, and locates any by ID", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-list-")).path

      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const database = yield* Database.Service
        const location = yield* Location.Service
        const row = (projectID: string, updated: number, provider = "local") => ({
          id: Artifact.ID.create(),
          project_id: projectID as typeof location.project.id,
          directory: projectID === location.project.id ? dir : "/elsewhere",
          provider: Artifact.ProviderID.make(provider),
          title: `updated ${updated}`,
          entry: "index.html",
          url: "https://example.test/",
          time_created: 1,
          time_updated: updated,
        })
        const rows = [
          row(location.project.id, 1),
          row(location.project.id, 3),
          row(location.project.id, 2, "console"),
          row("prj_other", 4),
        ]
        yield* database.db.insert(ArtifactTable).values(rows).run()

        expect((yield* artifacts.list()).map((item) => item.title)).toEqual(["updated 3", "updated 2", "updated 1"])
        expect(
          (yield* artifacts.list({ provider: Artifact.ProviderID.make("console") })).map((item) => item.title),
        ).toEqual(["updated 2"])
        expect(yield* Artifact.locate(database, rows[3]!.id)).toBe("/elsewhere")
        expect(yield* Artifact.locate(database, Artifact.ID.create())).toBeUndefined()
        expect(yield* artifacts.info(rows[3]!.id).pipe(Effect.flip)).toBeInstanceOf(Artifact.NotFoundError)
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )

  it.live("keeps the artifacts a previous release saved in KV", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-upgrade-")).path

      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const database = yield* Database.Service
        const kv = yield* KV.Service
        const location = yield* Location.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(dir) }) })
        const local = Artifact.ID.create()
        const shared = Artifact.ID.create()
        const legacy = (id: Artifact.ID, provider: string, url: string) => ({
          info: {
            id,
            provider,
            sessionID: session.id,
            title: `${provider} page`,
            entry: "index.html",
            url,
            time: { created: 100, updated: 200 },
          },
          directory: dir,
          projectID: location.project.id,
        })
        const consoleStorage = PluginHost.storage(kv, "opencode.provider.opencode")
        yield* kv.set(`artifact:item:${local}`, legacy(local, "local", `/api/experimental/artifacts/${local}/view/`))
        yield* kv.set(
          `artifact:item:${shared}`,
          legacy(shared, "console", "https://opencode.ai/console/artifacts/shared"),
        )
        yield* consoleStorage.set(`artifact-slug:${shared}`, "console-page-abc123")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(dir, ".data/artifacts", local, "assets"), { recursive: true })
          await fs.writeFile(path.join(dir, ".data/artifacts", local, "index.html"), "<h1>legacy</h1>")
          await fs.writeFile(path.join(dir, ".data/artifacts", local, "assets/app.js"), "console.log(1)")
        })
        // The database as the previous release left it, before this migration.
        yield* database.db.run(sql`DROP TABLE artifact`)
        yield* database.db.transaction((tx) => artifactMigration.up(tx))

        expect(yield* artifacts.list()).toEqual(
          [
            { id: shared, provider: "console", url: "https://opencode.ai/console/artifacts/shared" },
            { id: local, provider: "local", url: `/api/experimental/artifacts/${local}/view/` },
          ]
            .toSorted((a, b) => b.id.localeCompare(a.id))
            .map((item) => ({
              ...item,
              provider: Artifact.ProviderID.make(item.provider),
              sessionID: session.id,
              title: `${item.provider} page`,
              entry: "index.html",
              time: { created: 100, updated: 200 },
            })),
        )
        expect(new TextDecoder().decode((yield* artifacts.readLocalFile(local, "assets/app.js")).bytes)).toBe(
          "console.log(1)",
        )
        expect((yield* artifacts.get(local)).files).toEqual({
          "index.html": "<h1>legacy</h1>",
          "assets/app.js": "console.log(1)",
        })
        expect(yield* consoleStorage.get(`artifact-slug:${shared}`)).toBe("console-page-abc123")
        expect(yield* kv.get(`artifact:item:${local}`)).toBeUndefined()
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )
})
