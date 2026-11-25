import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Artifact } from "@opencode/core/artifact"
import { ArtifactTable } from "@opencode/core/artifact/sql"
import { Database } from "@opencode/core/database/database"
import { Flag } from "@opencode/core/flag"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { fromPromise } from "@opencode/plugin/promise/adapter"
import { ArtifactConformance } from "../../../core/test/lib/artifact-conformance"
import { testEffect } from "../../../core/test/lib/effect"
import { PluginTestLayer } from "../../../core/test/plugin/fixture"
import S3Artifacts from "../index"

const it = testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, "artifacts"))))
const provider = Artifact.ProviderID.make("s3")

/** Pinned here rather than read from the plugin's capabilities, so a plugin that over-promises fails. */
const expected = (spaRewrite: boolean) =>
  ({
    ...ArtifactConformance.expected.local,
    "spa-index": spaRewrite ? "accept" : "refuse",
  }) as const

/** A path-style S3 bucket, in-process: it keeps each object's bytes and Content-Type, and counts signed requests. */
function fakeS3() {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>()
  const state = { calls: 0 }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/bucket\//, ""))
      if (request.method === "GET") {
        const object = objects.get(key)
        return object
          ? new Response(object.bytes, { headers: { "content-type": object.type } })
          : new Response(null, { status: 404 })
      }
      if (!request.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 "))
        return new Response(null, { status: 403 })
      state.calls++
      if (request.method === "PUT") {
        objects.set(key, {
          bytes: new Uint8Array(await request.arrayBuffer()),
          type: request.headers.get("content-type") ?? "",
        })
        return new Response(null, { headers: { etag: '"1"' } })
      }
      if (request.method === "DELETE") {
        objects.delete(key)
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 405 })
    },
  })
  return { server, objects, state }
}

const withS3 = <A, E, R>(use: (s3: ReturnType<typeof fakeS3>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeS3), use, (s3) => Effect.promise(() => s3.server.stop(true)))

const options = (s3: ReturnType<typeof fakeS3>, extra: Record<string, unknown> = {}) => ({
  bucket: "bucket",
  prefix: "pages",
  endpoint: s3.server.url.origin,
  publicBaseUrl: `${s3.server.url.origin}/bucket/`,
  accessKeyId: "test",
  secretAccessKey: "test",
  ...extra,
})

const start = Effect.fnUntraced(function* (options: Record<string, unknown>) {
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* fromPromise(S3Artifacts).effect({ ...host, options })
})

/** What a reader gets at a path under the artifact's folder, read over HTTP from the public base URL. */
const reader = (publicBaseUrl: string, prefix: string) => (info: Artifact.Info, filePath: string) =>
  Effect.promise(async () => {
    const response = await fetch(`${publicBaseUrl.replace(/\/+$/, "")}/${prefix}/${info.id}/${filePath}`)
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined
  })

describe("s3 artifacts", () => {
  for (const spaRewrite of [false, true])
    it.effect(`meets its pinned conformance matrix ${spaRewrite ? "with" : "without"} spaRewrite`, () =>
      withS3((s3) =>
        Effect.gen(function* () {
          const config = options(s3, { spaRewrite })
          yield* start(config)
          yield* ArtifactConformance.run(
            { provider, fetch: reader(config.publicBaseUrl, "pages"), calls: () => s3.state.calls },
            expected(spaRewrite),
          )
        }),
      ),
    )

  it.effect("pins the write endpoint's host, bucket and prefix as the destination", () =>
    withS3((s3) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const database = yield* Database.Service
        yield* start(options(s3))
        const created = yield* artifacts.create({ title: "Report", provider, files: { "index.html": "<p>hi</p>" } })
        const rows = yield* database.db.select().from(ArtifactTable).all()
        expect(rows.find((row) => row.id === created.id)?.destination).toBe(`s3:${s3.server.url.host}/bucket/pages`)
      }),
    ),
  )

  it.effect("serves each file with its type, renders Markdown, and removes only its own stale files", () =>
    withS3((s3) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(options(s3))
        const doc = yield* artifacts.create({
          title: "Notes <1>",
          provider,
          files: { "index.md": "# Notes", "a.css": "" },
        })
        const other = yield* artifacts.create({ title: "Other", provider, files: { "index.html": "<p>other</p>" } })
        expect(doc.url).toBe(`${s3.server.url.origin}/bucket/pages/${doc.id}/index.html`)
        expect(other.visibility).toBe("public")
        const page = s3.objects.get(`pages/${doc.id}/index.html`)
        expect(page?.type).toBe("text/html; charset=utf-8")
        expect(new TextDecoder().decode(page?.bytes)).toContain("<title>Notes &lt;1&gt;</title>")
        expect(new TextDecoder().decode(page?.bytes)).toContain("<h1>Notes</h1>")
        expect(s3.objects.get(`pages/${doc.id}/a.css`)?.type).toBe("text/css; charset=utf-8")

        yield* artifacts.update(doc.id, { files: { "index.md": "# Notes" } })
        expect([...s3.objects.keys()].filter((key) => key.includes(doc.id)).toSorted()).toEqual([
          `pages/${doc.id}/index.html`,
          `pages/${doc.id}/index.md`,
        ])
        yield* artifacts.remove(doc.id)
        expect([...s3.objects.keys()]).toEqual([`pages/${other.id}/index.html`])
      }),
    ),
  )

  it.effect("links a single-page app's folder when the host rewrites to index.html", () =>
    withS3((s3) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(options(s3, { spaRewrite: true, prefix: "" }))
        const files = ArtifactConformance.fixtures["spa-index"].files
        const app = yield* artifacts.create({ title: "App", provider, files })
        expect(app.url).toBe(`${s3.server.url.origin}/bucket/${app.id}/`)
        expect(s3.objects.has(`${app.id}/index.html`)).toBe(true)
        expect(s3.objects.has(`${app.id}/src/main.ts`)).toBe(false)
      }),
    ),
  )

  it.effect("registers nothing until a bucket is configured", () =>
    Effect.gen(function* () {
      const artifacts = yield* Artifact.Service
      yield* start({})
      expect((yield* artifacts.providers()).map((item) => item.id)).not.toContain(provider)
    }),
  )
})

// Runs the same lifecycle against a real S3-compatible server when one is configured, such as a disposable MinIO.
const live = {
  endpoint: process.env.S3_ARTIFACTS_LIVE_ENDPOINT,
  bucket: process.env.S3_ARTIFACTS_LIVE_BUCKET,
  publicBaseUrl: process.env.S3_ARTIFACTS_LIVE_PUBLIC_BASE_URL,
  accessKeyId: process.env.S3_ARTIFACTS_LIVE_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_ARTIFACTS_LIVE_SECRET_ACCESS_KEY,
}
describe.skipIf(!live.endpoint)("s3 artifacts against a live server", () => {
  it.live(
    "meets its pinned conformance matrix",
    () =>
      Effect.gen(function* () {
        const prefix = `conformance-${Date.now()}`
        yield* start({ ...live, prefix })
        // A live server can't count requests, so the fake above proves refusals send nothing.
        yield* ArtifactConformance.run(
          { provider, fetch: reader(live.publicBaseUrl ?? "", prefix), calls: () => 0 },
          expected(false),
        )
        // Signing must encode keys as the server reads them, spaces and RFC 3986 reserved characters included.
        const artifacts = yield* Artifact.Service
        const odd = yield* artifacts.create({
          title: "Odd names",
          provider,
          files: { "index.html": "<p>hi</p>", "a b(1)!.css": "p{}" },
        })
        expect(yield* reader(live.publicBaseUrl ?? "", prefix)(odd, "a%20b(1)!.css")).toEqual(
          new TextEncoder().encode("p{}"),
        )
        yield* artifacts.remove(odd.id)
      }),
    60_000,
  )
})
