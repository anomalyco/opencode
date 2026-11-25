import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Artifact } from "@opencode/core/artifact"
import { ArtifactTable } from "@opencode/core/artifact/sql"
import { Database } from "@opencode/core/database/database"
import { Flag } from "@opencode/core/flag"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { ArtifactConformance } from "../../../core/test/lib/artifact-conformance"
import { testEffect } from "../../../core/test/lib/effect"
import { PluginTestLayer } from "../../../core/test/plugin/fixture"
import CloudflareArtifacts, { provider, type Receipt } from "../index"
import { fakeCloudflare } from "./fake-cloudflare"

const it = testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, "artifacts"))))
const cloudflare = Artifact.ProviderID.make("cloudflare")

const withCloudflare = <A, E, R>(use: (fake: ReturnType<typeof fakeCloudflare>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeCloudflare), use, (fake) => Effect.promise(fake.cleanup))

const start = Effect.fnUntraced(function* (fake: ReturnType<typeof fakeCloudflare>) {
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* PluginPromise.fromPromise({
    id: "cloudflare-test",
    async setup(ctx) {
      await ctx.experimental.artifact.transform((editor) =>
        editor.add(provider({ accountId: "account", apiToken: "token", fetch: fake.fetch })),
      )
    },
  }).effect(host)
})

const receipt = (id: Artifact.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const row = yield* database.db.select().from(ArtifactTable).where(eq(ArtifactTable.id, id)).get()
    return row?.receipt as unknown as Receipt
  })

const text = (fake: ReturnType<typeof fakeCloudflare>, url: string, init?: RequestInit) =>
  Effect.promise(() =>
    fake.serve(url, init).then(async (response) => ({ status: response.status, body: await response.text() })),
  )

const echo = (version: number) =>
  `export default { fetch: (request) => Response.json({ url: request.url, version: ${version} }) }`

const app = (manifest: object, files: Record<string, string>) => ({
  "artifact.json": JSON.stringify(manifest),
  ...files,
})

describe("Cloudflare artifacts", () => {
  it.effect("registers its provider only once an account and token are configured", () =>
    Effect.gen(function* () {
      const artifacts = yield* Artifact.Service
      const host = yield* PluginHost.make(yield* Plugin.Service, "test")
      yield* PluginPromise.fromPromise(CloudflareArtifacts).effect({ ...host, options: { accountId: "account" } })
      expect((yield* artifacts.providers()).map((item) => item.id)).not.toContain(cloudflare)
      yield* PluginPromise.fromPromise(CloudflareArtifacts).effect({
        ...host,
        options: { accountId: "account", apiToken: "token" },
      })
      expect(yield* artifacts.providers()).toContainEqual(
        Artifact.Provider.make({
          id: cloudflare,
          name: "Cloudflare",
          capabilities: ["static", "spa", "server-code", "sqlite", "kv", "blob", "cron"],
          audiences: ["public"],
          defaultAudience: "public",
          default: false,
        }),
      )
    }),
  )

  it.effect("meets the Cloudflare provider's pinned conformance matrix", () =>
    withCloudflare((fake) =>
      Effect.gen(function* () {
        yield* start(fake)
        yield* ArtifactConformance.run(
          {
            provider: cloudflare,
            fetch: (info, filePath) =>
              Effect.promise(async () => {
                const response = await fake.serve(new URL(filePath, new URL("/", info.url)))
                return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined
              }),
            calls: fake.calls,
          },
          {
            "markdown-doc": "accept",
            "static-binary": "accept",
            "nested-entry": "accept",
            "spa-index": "accept",
            "fetch-echo": "accept",
            sqlite: "accept",
            blob: "accept",
            cron: "accept",
          },
        )
      }),
    ),
  )

  it.effect("pins each binding's resource by name, and applies each migration once, in order", () =>
    withCloudflare((fake) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(fake)
        const bindings = [
          { name: "DB", kind: "sqlite", migrations: ["migrations"] },
          { name: "CACHE", kind: "kv" },
          { name: "PUBLISHED_DOCUMENTS", kind: "blob" },
        ]
        const files = {
          "server.js": echo(1),
          "migrations/0002_tags.sql": "CREATE TABLE tag (id INTEGER PRIMARY KEY);",
          "migrations/0001_init.sql": "CREATE TABLE note (id INTEGER PRIMARY KEY);",
        }
        const created = yield* artifacts.create({
          title: "Notes",
          provider: cloudflare,
          files: app({ server: "server.js", bindings }, files),
        })
        const first = yield* receipt(created.id)
        expect(Object.keys(first.bindings).toSorted()).toEqual(["CACHE", "DB", "PUBLISHED_DOCUMENTS"])
        expect(first.bindings.PUBLISHED_DOCUMENTS?.id).toBe(`${first.script}-published-documents`)
        expect(fake.state.uploads.at(-1)).toMatchObject({
          bindings: expect.arrayContaining([
            { type: "d1", name: "DB", id: first.bindings.DB?.id },
            { type: "kv_namespace", name: "CACHE", namespace_id: first.bindings.CACHE?.id },
            { type: "r2_bucket", name: "PUBLISHED_DOCUMENTS", bucket_name: first.bindings.PUBLISHED_DOCUMENTS?.id },
          ]),
          keep_bindings: expect.arrayContaining(["secret_text"]),
        })
        const db = fake.state.d1.get(first.bindings.DB!.id)!.db
        expect(db.query("SELECT name FROM d1_migrations ORDER BY id").all()).toEqual([
          { name: "0001_init.sql" },
          { name: "0002_tags.sql" },
        ])

        yield* artifacts.update(created.id, {
          files: app(
            { server: "server.js", bindings: bindings.toReversed() },
            { ...files, "migrations/0003_more.sql": "ALTER TABLE note ADD COLUMN body TEXT;" },
          ),
        })
        expect((yield* receipt(created.id)).bindings).toEqual(first.bindings)
        expect([fake.state.d1.size, fake.state.kv.size, fake.state.r2.size]).toEqual([1, 1, 1])
        expect(db.query("SELECT name FROM d1_migrations ORDER BY id").all()).toEqual([
          { name: "0001_init.sql" },
          { name: "0002_tags.sql" },
          { name: "0003_more.sql" },
        ])
      }),
    ),
  )

  it.effect("keeps the old Worker serving when the upload after a migration fails", () =>
    withCloudflare((fake) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(fake)
        const manifest = { server: "server.js", bindings: [{ name: "DB", kind: "sqlite", migrations: ["migrations"] }] }
        const migration = { "migrations/0001_init.sql": "CREATE TABLE note (id INTEGER PRIMARY KEY);" }
        const created = yield* artifacts.create({
          title: "Notes",
          provider: cloudflare,
          files: app(manifest, { "server.js": echo(1), ...migration }),
        })
        fake.state.failUpload = true
        const error = yield* artifacts
          .update(created.id, {
            files: app(manifest, {
              "server.js": echo(2),
              ...migration,
              "migrations/0002_body.sql": "ALTER TABLE note ADD COLUMN body TEXT;",
            }),
          })
          .pipe(Effect.flip)
        expect(String(error)).toContain("Unexpected token")
        const db = fake.state.d1.get((yield* receipt(created.id)).bindings.DB!.id)!.db
        expect(db.query("SELECT name FROM d1_migrations ORDER BY id").all()).toEqual([
          { name: "0001_init.sql" },
          { name: "0002_body.sql" },
        ])
        expect(JSON.parse((yield* text(fake, created.url + "echo")).body)).toMatchObject({ version: 1 })
        expect((yield* artifacts.get(created.id)).files["server.js"]).toBe(echo(1))
      }),
    ),
  )

  it.effect("deletes the Worker and keeps its databases, namespaces and buckets", () =>
    withCloudflare((fake) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(fake)
        const created = yield* artifacts.create({
          title: "Notes",
          provider: cloudflare,
          files: app(
            {
              server: "server.js",
              bindings: [
                { name: "DB", kind: "sqlite" },
                { name: "CACHE", kind: "kv" },
                { name: "FILES", kind: "blob" },
              ],
            },
            { "server.js": echo(1) },
          ),
        })
        const pinned = yield* receipt(created.id)
        yield* artifacts.remove(created.id)
        expect(fake.state.scripts.has(pinned.script)).toBe(false)
        expect(fake.state.d1.has(pinned.bindings.DB!.id)).toBe(true)
        expect(fake.state.kv.has(pinned.bindings.CACHE!.id)).toBe(true)
        expect(fake.state.r2.has(pinned.bindings.FILES!.id)).toBe(true)
      }),
    ),
  )

  it.effect("runs crons in the Worker, a path as an inside request the internet can't make", () =>
    withCloudflare((fake) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(fake)
        const runs = new Array<string>()
        Object.assign(globalThis, { cronRuns: runs })
        const created = yield* artifacts.create({
          title: "Cron",
          provider: cloudflare,
          files: app(
            {
              server: "server.js",
              crons: [{ schedule: "0 * * * *", path: "/tasks/hourly" }, { schedule: "*/5 * * * *" }],
            },
            {
              // A class default export, as a WorkerEntrypoint is, built per call with (ctx, env).
              "server.js": `export default class {
  constructor(ctx, env) { this.ctx = ctx }
  fetch(request) { globalThis.cronRuns.push("fetch " + new URL(request.url).pathname); return new Response("ran") }
  scheduled(controller) { this.ctx.waitUntil(Promise.resolve(globalThis.cronRuns.push("scheduled " + controller.cron))) }
}`,
            },
          ),
        })
        const script = (yield* receipt(created.id)).script
        expect(fake.state.scripts.get(script)?.schedules).toEqual([{ cron: "0 * * * *" }, { cron: "*/5 * * * *" }])
        expect(yield* text(fake, created.url + "tasks/hourly")).toEqual({ status: 404, body: "Not found" })
        yield* Effect.promise(() => fake.scheduled(script, "0 * * * *"))
        yield* Effect.promise(() => fake.scheduled(script, "*/5 * * * *"))
        expect(runs).toEqual(["fetch /tasks/hourly", "scheduled */5 * * * *"])

        yield* artifacts.update(created.id, {
          files: app({ server: "server.js" }, { "server.js": echo(2) }),
        })
        expect(fake.state.scripts.get(script)?.schedules).toEqual([])
      }),
    ),
  )
})
