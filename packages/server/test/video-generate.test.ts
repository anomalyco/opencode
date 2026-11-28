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

// An MP4 `ftyp` box, so the type is read from the bytes: "0123456789" are the first ten bytes.
const video = Uint8Array.from([0, 0, 0, 0x14, ...new TextEncoder().encode("ftypmp42"), 0, 0, 0, 0, 1, 2, 3, 4])

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
        result: () => Effect.succeed([{ mime: "video/mp4", stream: Stream.make(video) }]),
        cancel: () => Effect.void,
      },
    }),
  ),
  deps: [],
})

const serve = (dir: string) =>
  ServerFetch.make(
    {
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: {
        directory: dir,
        project: false,
        content: JSON.stringify({ experimental: { blob_catalog: true } }),
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
const unknown = `video_${"0".repeat(12)}${"A".repeat(14)}`

it.live("generates a video in the background and serves its blob with Range and ETag support", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-video-route-")).path
    const handler = yield* serve(dir)
    const call = (url: string, init?: RequestInit) => Effect.promise(() => handler(new Request(url, init)))

    const started = yield* call(`${base}/generate/video`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: { providerID: "test", id: "video" }, prompt: "a cat" }),
    })
    expect(started.status).toBe(200)
    const { data } = (yield* Effect.promise(() => started.json())) as { data: { id: string; status: string } }
    expect(data).toMatchObject({ status: "running" })
    expect(data.id.startsWith("video_")).toBe(true)

    const completed = yield* eventually(
      call(`${base}/generate/video/${data.id}`).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.json())),
      ),
      (body: { data: Record<string, unknown> }) => body.data.status !== "running",
    )
    const blob = (completed.data.blobs as { id: string }[])[0].id
    expect(blob.startsWith("blob_")).toBe(true)
    expect(completed.data).toMatchObject({ id: data.id, status: "completed", blobs: [{ mime: "video/mp4", bytes: 20 }] })
    const route = `${base}/blob/${blob}/content`

    const full = yield* call(route)
    expect(full.status).toBe(200)
    expect(full.headers.get("content-type")).toBe("video/mp4")
    expect(full.headers.get("accept-ranges")).toBe("bytes")
    expect(full.headers.get("etag")).toBe(`"${blob}"`)
    expect(full.headers.get("content-disposition")).toBe("attachment")
    expect(new Uint8Array(yield* Effect.promise(() => full.arrayBuffer()))).toEqual(video)

    const slice = yield* call(route, { headers: { range: "bytes=2-5" } })
    expect(slice.status).toBe(206)
    expect(slice.headers.get("content-range")).toBe("bytes 2-5/20")
    expect(new Uint8Array(yield* Effect.promise(() => slice.arrayBuffer()))).toEqual(video.slice(2, 6))
    const suffix = yield* call(route, { headers: { range: "bytes=-3" } })
    expect(new Uint8Array(yield* Effect.promise(() => suffix.arrayBuffer()))).toEqual(video.slice(17))
    const unsatisfiable = yield* call(route, { headers: { range: "bytes=20-" } })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */20")
    // A Range for another version of the bytes gets the whole body.
    const stale = yield* call(route, { headers: { range: "bytes=2-5", "if-range": '"other"' } })
    expect(stale.status).toBe(200)

    const cached = yield* call(route, { headers: { "if-none-match": `"${blob}"` } })
    expect(cached.status).toBe(304)
    expect((yield* Effect.promise(() => cached.arrayBuffer())).byteLength).toBe(0)

    // A restarted server reads the finished job back from its record.
    const restarted = yield* serve(dir)
    const reread = yield* Effect.promise(() => restarted(new Request(`${base}/generate/video/${data.id}`)))
    expect(((yield* Effect.promise(() => reread.json())) as { data: unknown }).data).toEqual(completed.data)

    // Once the blob is deleted, the job is gone too.
    expect((yield* call(`${base}/blob/${blob}`, { method: "DELETE" })).status).toBe(204)
    expect((yield* call(route)).status).toBe(404)
    expect((yield* call(`${base}/generate/video/${data.id}`)).status).toBe(404)

    expect((yield* call(`${base}/generate/video/${unknown}`)).status).toBe(404)
    // An ID that isn't one never reaches the disk.
    expect((yield* call(`${base}/blob/blob_..%2F..%2Fsecret`)).status).toBe(400)
  }).pipe(Effect.scoped),
  // The first status check runs at the next 5-second check.
  15_000,
)

it.live("uploads a blob, labels it with a session and edits its metadata", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-blob-route-")).path
    const handler = yield* serve(dir)
    const call = (url: string, init?: RequestInit) => Effect.promise(() => handler(new Request(url, init)))
    const json = (response: Response) => Effect.promise(() => response.json() as Promise<{ data: any }>)
    const sessionID = "ses_" + "0".repeat(26)

    const created = yield* call(`${base}/blob?name=clip.mp4&sessionID=${sessionID}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: video,
    })
    expect(created.status).toBe(200)
    const info = (yield* json(created)).data
    expect(info).toMatchObject({ name: "clip.mp4", sessionID, mime: "video/mp4", bytes: 20 })

    expect((yield* json(yield* call(`${base}/blob?sessionID=${sessionID}`))).data).toEqual([info])
    const updated = yield* call(`${base}/blob/${info.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: { starred: true } }),
    })
    expect((yield* json(updated)).data).toMatchObject({ name: "clip.mp4", metadata: { starred: true } })
    const tooBig = yield* call(`${base}/blob/${info.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: { note: "x".repeat(5000) } }),
    })
    expect(tooBig.status).toBe(400)
    expect((yield* json(yield* call(`${base}/blob/${info.id}`))).data).toMatchObject({ metadata: { starred: true } })
  }).pipe(Effect.scoped),
)
