import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Generate } from "@opencode/core/generate"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Stream } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { eventually } from "../../core/test/lib/eventually"
import { ServerFetch } from "../src/fetch"

const video = new TextEncoder().encode("0123456789")

// A provider whose jobs finish on the first status read.
const generate = makeLocationNode({
  service: Generate.Service,
  layer: Layer.succeed(
    Generate.Service,
    Generate.Service.of({
      text: () => Effect.die("unused"),
      image: () => Effect.die("unused"),
      decisions: () => Effect.die("unused"),
      video: {
        start: () => Effect.succeed({ id: "provider_1" }),
        status: () => Effect.succeed({ status: "completed" }),
        result: () => Effect.succeed({ mime: "video/mp4", stream: Stream.make(video) }),
      },
    }),
  ),
  deps: [],
})

const serve = (dir: string, enabled: boolean) =>
  ServerFetch.make(
    {
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: {
        directory: dir,
        project: false,
        content: JSON.stringify({ experimental: { video_generate: enabled } }),
      },
      models: { fetch: false },
      fs: { filewatcher: false },
    },
    // Blobs go under the test's own data directory.
    {
      overrides: [
        Global.node.replace(Global.layerWith({ data: path.join(dir, "data"), config: dir })),
        Generate.node.replace(generate),
      ],
    },
  )

const base = "http://opencode.local/api/experimental"

it.live("generates a video in the background and serves it by hash with Range and ETag support", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-video-route-")).path
    const handler = yield* serve(dir, true)
    const call = (url: string, init?: RequestInit) => Effect.promise(() => handler(new Request(url, init)))

    const started = yield* call(`${base}/generate/video`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: { providerID: "test", id: "video" }, prompt: "a cat", expiresAfter: 3600 }),
    })
    expect(started.status).toBe(200)
    const { data } = (yield* Effect.promise(() => started.json())) as { data: { id: string; status: string } }
    expect(data).toMatchObject({ status: "running" })
    expect(data.id.startsWith("gen_")).toBe(true)

    const completed = yield* eventually(
      call(`${base}/generate/video/${data.id}`).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.json())),
      ),
      (body: { data: { status: string } }) => body.data.status !== "running",
    )
    expect(completed.data).toMatchObject({ id: data.id, status: "completed" })
    const { media } = completed.data as unknown as { media: string[] }
    const hash = media[0]!.slice("media:".length)
    const route = `${base}/media/${hash}`

    const full = yield* call(route)
    expect(full.status).toBe(200)
    expect(full.headers.get("content-type")).toBe("video/mp4")
    expect(full.headers.get("accept-ranges")).toBe("bytes")
    expect(full.headers.get("etag")).toBe(`"${hash}"`)
    expect(full.headers.get("content-disposition")).toBe("attachment")
    expect(yield* Effect.promise(() => full.text())).toBe("0123456789")

    const slice = yield* call(route, { headers: { range: "bytes=2-5" } })
    expect(slice.status).toBe(206)
    expect(slice.headers.get("content-range")).toBe("bytes 2-5/10")
    expect(yield* Effect.promise(() => slice.text())).toBe("2345")
    const suffix = yield* call(route, { headers: { range: "bytes=-3" } })
    expect(yield* Effect.promise(() => suffix.text())).toBe("789")
    const unsatisfiable = yield* call(route, { headers: { range: "bytes=20-" } })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */10")
    // A Range for another version of the bytes gets the whole body.
    const stale = yield* call(route, { headers: { range: "bytes=2-5", "if-range": '"other"' } })
    expect(stale.status).toBe(200)

    // Shipped iOS probes with the quoted hash; that answers 304 without a body.
    const cached = yield* call(route, { headers: { "if-none-match": `"${hash}"` } })
    expect(cached.status).toBe(304)
    expect((yield* Effect.promise(() => cached.arrayBuffer())).byteLength).toBe(0)

    // A file gone from disk is missing, not an empty 200; the job and its row are left alone.
    yield* Effect.promise(() => fs.rm(path.join(dir, "data", "blobs", hash.slice(0, 2), hash)))
    expect((yield* call(route)).status).toBe(404)
    expect((yield* call(route, { headers: { "if-none-match": `"${hash}"` } })).status).toBe(404)

    expect((yield* call(`${base}/generate/video/gen_unknown`)).status).toBe(404)
  }).pipe(Effect.scoped),
)

it.live("rejects video routes while experimental.video_generate is off", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-video-off-")).path
    const handler = yield* serve(dir, false)
    const start = yield* Effect.promise(() =>
      handler(
        new Request(`${base}/generate/video`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: { providerID: "test", id: "video" }, prompt: "a cat" }),
        }),
      ),
    )
    expect(start.status).toBe(403)
    expect((yield* Effect.promise(() => handler(new Request(`${base}/generate/video/gen_1`)))).status).toBe(403)
  }).pipe(Effect.scoped),
)
