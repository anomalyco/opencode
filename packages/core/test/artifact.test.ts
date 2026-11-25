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
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import artifactMigration from "@opencode/core/database/migration/20261125001949_artifact"
import providerMigration from "@opencode/core/database/migration/20261125002931_artifact-provider"
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
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { AbsolutePath } from "@opencode/schema/schema"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { ArtifactConformance } from "./lib/artifact-conformance"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const toolPaths = [
  "opencode.artifact_create",
  "opencode.artifact_read",
  "opencode.artifact_update",
  "opencode.artifact_delete",
]

const buildLayer = (
  artifactsEnabled: boolean,
  dir: string,
  asserted: Permission.AssertInput[] = [],
  deny: (input: Permission.AssertInput) => boolean = () => false,
) => {
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
      Environment.node,
      FileAccess.node,
      FSUtil.node,
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
      Permission.node.replace(
        permissionLayer({
          assert: (input) =>
            Effect.sync(() => void asserted.push(input)).pipe(
              Effect.andThen(
                deny(input)
                  ? Effect.fail(
                      new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources }),
                    )
                  : Effect.void,
              ),
            ),
        }),
      ),
    ],
  )
}

const runCodeMode = (registry: Tool.Interface, sessionID: Session.ID, name: string, input: unknown) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: {
      type: "tool-call",
      id: `call-${name}`,
      name: "execute",
      input: { code: `return await tools.opencode.${name}(${JSON.stringify(input)})` },
    },
  })

/** The text of a call that is expected to fail. */
const failCodeMode = (registry: Tool.Interface, sessionID: Session.ID, name: string, input: unknown) =>
  runCodeMode(registry, sessionID, name, input).pipe(
    Effect.map((result) => JSON.stringify(result.status === "completed" ? result.content : result.error)),
  )

const callCodeMode = (registry: Tool.Interface, sessionID: Session.ID, name: string, input: unknown) =>
  runCodeMode(registry, sessionID, name, input).pipe(
    Effect.map((result) => {
      if (result.status !== "completed") {
        throw new Error(`Tool ${name} failed: ${JSON.stringify(result.error)}`)
      }
      return JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "")
    }),
  )

const it = testEffect(Layer.empty)

const assetBytes = (input: { readonly assets: Readonly<Record<string, { readonly bytes: Uint8Array }>> }) =>
  Object.fromEntries(Object.entries(input.assets).map(([filePath, file]) => [filePath, file.bytes]))

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
            audiences: ["public"],
            defaultAudience: "public",
            prompt: "Artifacts deploy to Cloudflare with SQLite and Durable Objects.",
            destination: () => Effect.succeed("cloudflare:acct_1"),
            create: (input) =>
              Effect.sync(() => {
                remoteStore.set(input.id, assetBytes(input))
                return { url: `https://cf.example.test/${input.id}/` }
              }),
            read: (id) => Effect.sync(() => remoteStore.get(id) ?? {}),
            update: (id, input) =>
              Effect.sync(() => {
                remoteStore.set(id, assetBytes(input))
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
          "Default provider (cloudflare [static, server-code, sqlite, durable-objects; public]): Artifacts deploy to Cloudflare with SQLite and Durable Objects.",
        )
        expect(createTool?.description).toContain(
          "Other active providers (pass provider to override): local [static; local].",
        )
        expect(createTool?.description).toContain("With it, only the assets folder is public")

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

        // A read names the files it leaves out, and update says it keeps them.
        const large = yield* artifacts.create({
          title: "Large",
          provider: Artifact.LocalProviderID,
          files: { "index.html": "<h1>hi</h1>", "data.json": "0".repeat(65 * 1024) },
        })
        const read = yield* executeTool(registry, {
          sessionID: session.id,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-read", name: "opencode_artifact_read", input: { id: large.id } },
        })
        expect(read.content?.[0]).toEqual({
          type: "text",
          text: `Large (${large.id} · 1 files); omitted: data.json (66560 bytes)`,
        })
        expect(rawTools.find((item) => item.id === "opencode_artifact_update")?.description).toContain(
          "Files a read listed in omitted are kept unless you send that path",
        )

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
          audiences: ["private"],
          defaultAudience: "private",
          prompt: id,
          destination: () => Effect.succeed(id),
          create: (input) => Effect.sync(() => void remote.set(input.id, assetBytes(input))).pipe(Effect.as({})),
          update: (artifactID, input) =>
            Effect.sync(() => void remote.set(artifactID, assetBytes(input))).pipe(Effect.as({})),
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

        // An update keeps the files that read left out, since they can't be sent back, and drops the rest it omits.
        yield* artifacts.update(page.id, { files: { "index.html": "<h1>v2</h1>", "d.txt": "d" } })
        expect(Object.keys(remote.get(page.id) ?? {}).toSorted()).toEqual(["big.txt", "d.txt", "index.html"])
        expect((yield* artifacts.get(page.id)).files).toEqual({ "index.html": "<h1>v2</h1>", "d.txt": "d" })

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
        yield* database.db.transaction((tx) => Effect.andThen(artifactMigration.up(tx), providerMigration.up(tx)))

        expect(yield* artifacts.list()).toEqual(
          [
            {
              id: shared,
              provider: "console",
              url: "https://opencode.ai/console/artifacts/shared",
              visibility: "private" as const,
            },
            {
              id: local,
              provider: "local",
              url: `/api/experimental/artifacts/${local}/view/`,
              visibility: "local" as const,
            },
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
        // Only local artifacts had files on disk, so another host's can't be read until it's loaded.
        expect(yield* artifacts.get(shared).pipe(Effect.flip)).toBeInstanceOf(Artifact.ProviderNotFoundError)
        expect(yield* kv.get(`artifact:item:${local}`)).toBeUndefined()
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )
  it.live("meets the local provider's pinned conformance matrix", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-local-conformance-")).path
      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* ArtifactConformance.run(
          {
            provider: Artifact.LocalProviderID,
            fetch: (info, filePath) =>
              artifacts.readLocalFile(info.id, filePath).pipe(
                Effect.map((file) => file.bytes),
                Effect.catchTag("Artifact.NotFoundError", () => Effect.undefined),
              ),
            calls: () => 0,
          },
          ArtifactConformance.expected.local,
        )
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )

  it.live("publishes only an artifact.json's assets, sends its server files privately, and keeps its audience", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-manifest-")).path
      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const inputs = new Array<Parameters<Artifact.ProviderImplementation["create"]>[0]>()
        yield* artifacts.transform((editor) => editor.add(cloud(inputs)))
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        const files = {
          "artifact.json": JSON.stringify({
            assets: "public",
            server: "server.js",
            bindings: [{ name: "DB", kind: "sqlite", migrations: ["migrations"] }],
          }),
          "public/index.html": "<h1>App</h1>",
          "public/logo.png": png,
          "server.js": "export default {}",
          "migrations/0001_init.sql": "CREATE TABLE note (id integer PRIMARY KEY);",
          "src/app.ts": "// source stays here",
        }
        const created = yield* artifacts.create({
          title: "App",
          provider: Artifact.ProviderID.make("cloud"),
          visibility: "private",
          files,
        })
        expect(created).toMatchObject({ entry: "index.html", visibility: "private" })
        expect(inputs[0]).toMatchObject({
          entry: "index.html",
          visibility: "private",
          destination: "cloud:acct_1",
          manifest: {
            assets: "public",
            spa: false,
            server: "server.js",
            bindings: [{ name: "DB", kind: "sqlite", migrations: ["migrations"] }],
            crons: [],
          },
          assets: { "index.html": { contentType: "text/html; charset=utf-8" }, "logo.png": { bytes: png } },
        })
        expect(Object.keys(inputs[0]?.assets ?? {}).toSorted()).toEqual(["index.html", "logo.png"])
        expect(Object.keys(inputs[0]?.serverFiles ?? {}).toSorted()).toEqual(["migrations/0001_init.sql", "server.js"])
        const content = yield* artifacts.get(created.id)
        expect(Object.keys(content.files).toSorted()).toEqual([
          "artifact.json",
          "migrations/0001_init.sql",
          "public/index.html",
          "server.js",
        ])
        expect(content.omitted).toEqual({ "public/logo.png": png.length })

        // An update keeps the audience the create chose and passes back what the provider returned.
        yield* artifacts.update(created.id, { files })
        expect(inputs[1]).toMatchObject({ visibility: "private", receipt: { script: created.id } })

        const refused = (input: Partial<Artifact.CreateInput> & { readonly files: Artifact.Files }) =>
          artifacts.create({ title: "Refused", ...input }).pipe(Effect.flip)
        const cloudID = Artifact.ProviderID.make("cloud")
        const overlap = yield* refused({
          provider: cloudID,
          files: {
            "artifact.json": JSON.stringify({ assets: "dist", server: "dist/server.js" }),
            "dist/index.html": "<h1>App</h1>",
            "dist/server.js": "export default {}",
          },
        })
        expect(overlap.message).toContain("overlap")
        expect(
          yield* refused({ provider: cloudID, files: { "artifact.json": '{"assets":"."}', "index.html": "" } }),
        ).toBeInstanceOf(Artifact.InvalidError)
        expect(
          yield* refused({ provider: cloudID, files: { "artifact.json": '{"spa":true}', "index.html": "" } }),
        ).toBeInstanceOf(Artifact.InvalidError)
        const spa = yield* refused({
          files: { "artifact.json": '{"assets":"dist","spa":true}', "dist/index.html": "" },
        })
        expect(spa.message).toBe(
          "Provider local can't publish this artifact: it doesn't support spa. Active providers that can: cloud.",
        )
        const audience = yield* refused({ visibility: "public", files: { "index.html": "" } })
        expect(audience.message).toContain("it doesn't support public artifacts. Active providers that can: cloud.")
        const unserved = yield* refused({
          provider: cloudID,
          files: {
            "artifact.json": JSON.stringify({ assets: "public", bindings: [{ name: "DB", kind: "kv" }] }),
            "public/index.html": "",
          },
        })
        expect(unserved.message).toBe("artifact.json's bindings and crons need a server bundle")
        const unmigrated = yield* refused({
          provider: cloudID,
          files: {
            "artifact.json": JSON.stringify({
              server: "server.js",
              bindings: [{ name: "DB", kind: "sqlite", migrations: ["migrations"] }],
            }),
            "server.js": "export default {}",
          },
        })
        expect(unmigrated.message).toBe("artifact.json's migrations folder migrations has no files")
        // A saved approval matches a destination as a rule, so one with a wildcard is refused.
        yield* artifacts.transform((editor) =>
          editor.add({
            ...cloud(inputs),
            id: Artifact.ProviderID.make("wild"),
            destination: () => Effect.succeed("wild:*"),
          }),
        )
        expect(
          yield* refused({ provider: Artifact.ProviderID.make("wild"), files: { "index.html": "" } }),
        ).toBeInstanceOf(Artifact.ProviderError)
        expect(inputs).toHaveLength(2)
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )

  it.live("carries over only the public files a read left out, and only into the same layout", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-carry-")).path
      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const inputs = new Array<Parameters<Artifact.ProviderImplementation["create"]>[0]>()
        yield* artifacts.transform((editor) => editor.add(cloud(inputs)))
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        // Past the inline limit, so a read leaves the server bundle out too.
        const bundle = `export default {}\n//${"x".repeat(65 * 1024)}`
        const manifest = JSON.stringify({ assets: "public", server: "server.js" })
        const created = yield* artifacts.create({
          title: "App",
          provider: Artifact.ProviderID.make("cloud"),
          files: {
            "artifact.json": manifest,
            "public/index.html": "<h1>v1</h1>",
            "public/logo.png": png,
            "server.js": bundle,
          },
        })
        expect((yield* artifacts.get(created.id)).omitted).toEqual({
          "public/logo.png": png.length,
          "server.js": bundle.length,
        })

        // The same layout keeps the image the read left out, and the server bundle must be sent again.
        expect(
          yield* artifacts
            .update(created.id, { files: { "artifact.json": manifest, "public/index.html": "<h1>v2</h1>" } })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Artifact.InvalidError)
        yield* artifacts.update(created.id, {
          files: { "artifact.json": manifest, "public/index.html": "<h1>v2</h1>", "server.js": bundle },
        })
        expect(Object.keys(inputs[1]?.assets ?? {}).toSorted()).toEqual(["index.html", "logo.png"])

        // Without artifact.json every file is public, so nothing the read left out carries over.
        yield* artifacts.update(created.id, { files: { "index.html": "<h1>flat</h1>" } })
        expect(Object.keys(inputs[2]?.assets ?? {})).toEqual(["index.html"])
      }).pipe(Effect.provide(buildLayer(true, dir)))
    }),
  )

  it.live("publishes a folder through the tools, asking before it publishes past this server", () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-artifact-folder-")).path
      const outside = (yield* tmpdirScoped("opencode-artifact-elsewhere-")).path
      const elsewhere = yield* Effect.promise(() => fs.realpath(outside))
      const asserted: Permission.AssertInput[] = []
      const site = path.join(dir, "site")
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(site, "node_modules/lib"), { recursive: true })
        await fs.mkdir(path.join(site, "sub"), { recursive: true })
        await fs.writeFile(path.join(site, "index.html"), "<h1>Folder</h1>")
        await fs.writeFile(path.join(site, "logo.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
        await fs.writeFile(path.join(site, "sub/app.js"), "console.log(1)")
        await fs.writeFile(path.join(site, ".env"), "SECRET=1")
        await fs.writeFile(path.join(site, "node_modules/lib/index.js"), "")
        await fs.writeFile(path.join(dir, "secret.txt"), "secret")
        await fs.mkdir(path.join(dir, "keys"))
        await fs.writeFile(path.join(dir, "keys/index.html"), "<h1>Keys</h1>")
        await fs.writeFile(path.join(dir, "keys/credentials.json"), "{}")
        await fs.mkdir(path.join(dir, "app/dist"), { recursive: true })
        await fs.mkdir(path.join(dir, "app/src"))
        await fs.writeFile(path.join(dir, "app/artifact.json"), JSON.stringify({ assets: "dist" }))
        await fs.writeFile(path.join(dir, "app/dist/index.html"), "<h1>App</h1>")
        await fs.writeFile(path.join(dir, "app/src/main.ts"), "")
        await fs.symlink(path.join(dir, "secret.txt"), path.join(dir, "app/src/secret.txt"))
        await fs.mkdir(path.join(elsewhere, "site"))
        await fs.writeFile(path.join(elsewhere, "site/index.html"), "<h1>Elsewhere</h1>")
        await fs.symlink(path.join(elsewhere, "site"), path.join(dir, "linked"))
      })
      yield* Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const registry = yield* Tool.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(dir) }) })
        const inputs = new Array<Parameters<Artifact.ProviderImplementation["create"]>[0]>()
        yield* artifacts.transform((editor) => editor.add(cloud(inputs)))
        yield* registerToolPlugin(ArtifactTools.Plugin, { event: { subscribe: () => Stream.never } })
        const publishes = () => asserted.filter((input) => input.action === "artifact_publish")

        const shared = (yield* callCodeMode(registry, session.id, "artifact_create", {
          title: "Folder",
          directory: "site",
          provider: "cloud",
        })) as Artifact.Info
        expect(Object.keys(inputs[0]?.assets ?? {}).toSorted()).toEqual(["index.html", "logo.png", "sub/app.js"])
        expect(asserted.find((input) => input.action === "read")?.resources).toEqual(["site"])
        expect(publishes().map((input) => input.resources)).toEqual([["cloud:acct_1:public"]])

        // Local artifacts stay on this server, so they publish without asking.
        yield* callCodeMode(registry, session.id, "artifact_create", { title: "Local", directory: "site" })
        expect(publishes()).toHaveLength(1)

        // A folder is the whole artifact: a file removed from it is gone, binary or not.
        yield* Effect.promise(() => fs.rm(path.join(site, "logo.png")))
        yield* callCodeMode(registry, session.id, "artifact_update", { id: shared.id, directory: "site" })
        expect(Object.keys(inputs[1]?.assets ?? {}).toSorted()).toEqual(["index.html", "sub/app.js"])
        expect(publishes()).toHaveLength(2)

        expect(
          yield* failCodeMode(registry, session.id, "artifact_create", {
            title: "Both",
            directory: "site",
            files: { "index.html": "" },
          }),
        ).toContain("Pass either files or directory")
        yield* Effect.promise(() => fs.symlink(path.join(dir, "secret.txt"), path.join(site, "link.txt")))
        expect(
          yield* failCodeMode(registry, session.id, "artifact_create", { title: "Link", directory: "site" }),
        ).toContain("Can't publish link.txt: symlinks and special files aren't published")
        yield* Effect.promise(async () => {
          await fs.rm(path.join(site, "link.txt"))
          await fs.writeFile(path.join(site, "big.bin"), new Uint8Array(25 * 1024 * 1024 + 1))
        })
        expect(
          yield* failCodeMode(registry, session.id, "artifact_create", { title: "Big", directory: "site" }),
        ).toContain("big.bin is over the 25 MiB limit for one file")
        expect(inputs).toHaveLength(2)

        // Every file's own read rules apply, before any of it is read or published.
        expect(asserted.find((input) => input.action === "read" && input.resources.length > 1)?.resources).toEqual(
          expect.arrayContaining(["site/index.html", "site/logo.png", "site/sub/app.js"]),
        )
        expect(
          yield* failCodeMode(registry, session.id, "artifact_create", { title: "Keys", directory: "keys" }),
        ).toContain("Permission denied: read")
        expect(inputs).toHaveLength(2)

        // With artifact.json, only what it declares is read; the rest, symlinks included, stays unread.
        yield* callCodeMode(registry, session.id, "artifact_create", {
          title: "App",
          directory: "app",
          provider: "cloud",
        })
        expect(Object.keys(inputs[2]?.assets ?? {})).toEqual(["index.html"])
        expect(asserted.flatMap((input) => input.resources).filter((resource) => resource.startsWith("app/"))).toEqual([
          "app/artifact.json",
          "app/dist/index.html",
        ])

        // A folder whose real path is elsewhere needs approval there too.
        yield* callCodeMode(registry, session.id, "artifact_create", {
          title: "Linked",
          directory: "linked",
          provider: "cloud",
        })
        expect(
          asserted.some(
            (input) =>
              input.action === "external_directory" &&
              input.resources.some((resource) => resource.startsWith(elsewhere)),
          ),
        ).toBe(true)

        // Only this server's own provider publishes without asking, and a plugin can't replace it.
        yield* artifacts.transform((editor) => {
          editor.add({
            ...cloud(inputs),
            id: Artifact.ProviderID.make("lan"),
            audiences: ["local"],
            defaultAudience: "local",
          })
          editor.add({ ...cloud(inputs), id: Artifact.LocalProviderID })
        })
        yield* callCodeMode(registry, session.id, "artifact_create", {
          title: "LAN",
          files: { "index.html": "" },
          provider: "lan",
        })
        expect(publishes().at(-1)?.resources).toEqual(["cloud:acct_1:local"])
        expect((yield* artifacts.providers()).find((item) => item.id === Artifact.LocalProviderID)?.name).toBe("Local")
      }).pipe(
        Effect.provide(
          buildLayer(true, dir, asserted, (input) => input.resources.some((item) => item.endsWith("credentials.json"))),
        ),
      )
    }),
  )
})

/** A cloud host that serves static files, SPAs and server code, publicly or privately, and records what it's sent. */
function cloud(inputs: Parameters<Artifact.ProviderImplementation["create"]>[0][]): Artifact.ProviderImplementation {
  return {
    id: Artifact.ProviderID.make("cloud"),
    name: "Cloud",
    capabilities: ["static", "spa", "server-code", "sqlite"],
    audiences: ["public", "private"],
    defaultAudience: "public",
    prompt: "Cloud",
    destination: () => Effect.succeed("cloud:acct_1"),
    create: (input) =>
      Effect.sync(() => {
        inputs.push(input)
        return { url: `https://cloud.example.test/${input.id}/`, receipt: { script: input.id } }
      }),
    update: (_, input) => Effect.sync(() => void inputs.push(input)).pipe(Effect.as({})),
    delete: () => Effect.void,
  }
}
