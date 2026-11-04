import { Database as Sqlite } from "bun:sqlite"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode, type SessionMessageInfo } from "@opencode/client"
import { Session } from "@opencode/schema/session"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const text = Buffer.from("workspace file contents").toString("base64")
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString("base64")
const html = Buffer.from("<!doctype html><script>alert(1)</script>").toString("base64")
const hash = (base64: string) => createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex")
const size = (base64: string) => Buffer.from(base64, "base64").byteLength

const user: SessionMessageInfo = {
  id: "msg_media_user",
  type: "user",
  text: "See attached",
  files: [
    { data: png, mime: "image/png", source: { type: "inline" }, name: "shot.png" },
    {
      data: text,
      mime: "text/plain",
      source: { type: "uri", uri: "file:///workspace/readme.txt" },
      name: "readme.txt",
    },
    { data: svg, mime: "image/svg+xml", source: { type: "inline" }, name: "xss.svg" },
    { data: html, mime: "text/html", source: { type: "inline" }, name: "xss.html" },
  ],
  time: { created: 100 },
}

const assistant: SessionMessageInfo = {
  id: "msg_media_assistant",
  type: "assistant",
  agent: "build",
  model: { providerID: "test", id: "test" },
  content: [
    {
      type: "tool",
      id: "call_read_img",
      name: "read",
      executed: true,
      state: {
        status: "completed",
        input: { path: "shot.png" },
        content: [{ type: "file", uri: `data:image/png;base64,${png}`, mime: "image/png", name: "shot.png" }],
      },
      time: { created: 110, ran: 111, completed: 112 },
    },
  ],
  finish: "stop",
  time: { created: 110, completed: 120 },
}

const serve = (database: string, mediaBlob: boolean) =>
  ServerFetch.make({
    app: { version: "test" },
    database: { path: database },
    config: { project: false, content: JSON.stringify(mediaBlob ? { experimental: { media_blob: true } } : {}) },
    models: { fetch: false },
    fs: { filewatcher: false },
  })

const client = (handler: (request: Request) => Promise<Response>, capabilities?: string) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    ...(capabilities === undefined ? {} : { headers: { "X-OpenCode-Capabilities": capabilities } }),
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

const media = (base64: string) => `media:${hash(base64)}`
const route = (base64: string) => `http://opencode.local/api/experimental/media/${hash(base64)}`

it.live("serves stored media as refs only to clients that opt in while experimental.media_blob is on", () =>
  Effect.gen(function* () {
    // Acquired first so it is removed after the servers below are released; Windows can't delete an open db.
    const dir = (yield* tmpdirScoped("opencode-media-wire-")).path
    yield* Effect.gen(function* () {
      const database = path.join(dir, "opencode.db")
      const handler = yield* serve(database, true)
      const plain = client(handler)
      const opted = client(handler, "other, Experimental-Media-URI")
      const sessionID = Session.ID.create()

      yield* Effect.promise(async () => {
        const template = await plain.session.create({ title: "Media wire" })
        // With the flag on, import stores the media as blobs.
        await plain.experimental.session.import({ info: { ...template, id: sessionID }, messages: [user, assistant] })

        // Without the capability, reads stay byte-for-byte what was imported.
        expect((await plain.message.list({ sessionID, order: "asc" })).data).toEqual([user, assistant])

        const refs: unknown = (await opted.message.list({ sessionID, order: "asc" })).data
        expect(refs).toEqual([
          {
            ...user,
            files: [
              {
                uri: media(png),
                mime: "image/png",
                source: { type: "inline" },
                name: "shot.png",
                bytes: size(png),
              },
              {
                uri: media(text),
                mime: "text/plain",
                source: { type: "uri", uri: "file:///workspace/readme.txt" },
                name: "readme.txt",
                bytes: size(text),
              },
              {
                uri: media(svg),
                mime: "image/svg+xml",
                source: { type: "inline" },
                name: "xss.svg",
                bytes: size(svg),
              },
              {
                uri: media(html),
                mime: "text/html",
                source: { type: "inline" },
                name: "xss.html",
                bytes: size(html),
              },
            ],
          },
          {
            ...assistant,
            content: [
              {
                type: "tool",
                id: "call_read_img",
                name: "read",
                executed: true,
                state: {
                  status: "completed",
                  input: { path: "shot.png" },
                  content: [{ type: "file", uri: media(png), mime: "image/png", name: "shot.png" }],
                },
                time: { created: 110, ran: 111, completed: 112 },
              },
            ],
          },
        ])
        const single: unknown = await opted.session.message.get({ sessionID, messageID: "msg_media_user" })
        expect(single).toMatchObject({ files: [{ uri: media(png) }, { uri: media(text) }, {}, {}] })
        expect(await plain.session.message.get({ sessionID, messageID: "msg_media_user" })).toEqual(user)
        expect((await opted.experimental.session.export({ sessionID })).messages).toEqual([user, assistant])

        // The route serves raw bytes, immutable caching and a 304, and never renders active content inline.
        const image = await handler(new Request(route(png)))
        expect(image.status).toBe(200)
        expect(image.headers.get("content-type")).toBe("image/png")
        expect(image.headers.get("content-disposition")).toBeNull()
        expect(image.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
        expect(image.headers.get("etag")).toBe(`"${hash(png)}"`)
        expect(image.headers.get("x-content-type-options")).toBe("nosniff")
        expect(image.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox")
        expect(Buffer.from(await image.arrayBuffer()).toString("base64")).toBe(png)
        for (const unsafe of [svg, html]) {
          const response = await handler(new Request(route(unsafe)))
          expect(response.headers.get("content-type")).toBe("application/octet-stream")
          expect(response.headers.get("content-disposition")).toBe("attachment")
          expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox")
          expect(Buffer.from(await response.arrayBuffer()).toString("base64")).toBe(unsafe)
        }
        const cached = await handler(new Request(route(png), { headers: { "If-None-Match": `W/"${hash(png)}"` } }))
        expect(cached.status).toBe(304)
        expect(cached.headers.get("etag")).toBe(`"${hash(png)}"`)
        expect((await cached.arrayBuffer()).byteLength).toBe(0)
        for (const invalid of ["deadbeef", "A".repeat(64), "g".repeat(64)])
          expect((await handler(new Request(`http://opencode.local/api/experimental/media/${invalid}`))).status).toBe(
            400,
          )
        expect(
          (await handler(new Request(`http://opencode.local/api/experimental/media/${"0".repeat(64)}`))).status,
        ).toBe(404)
        expect(Buffer.from(await opted.experimental.media.get({ hash: hash(png) })).toString("base64")).toBe(png)

        // A `media:` ref a client received can be sent back as an attachment; pending input keeps it a ref.
        const queued = await opted.session.prompt({
          sessionID,
          text: "Again",
          files: [{ uri: media(png), name: "again.png" }],
          delivery: "queue",
          resume: false,
        })
        const pending: unknown = await opted.session.inbox.list({ sessionID })
        expect(pending).toMatchObject([
          {
            id: queued.id,
            payload: {
              files: [{ uri: media(png), mime: "image/png", name: "again.png", bytes: size(png) }],
            },
          },
        ])
        expect(await plain.session.inbox.list({ sessionID })).toMatchObject([
          { id: queued.id, payload: { files: [{ data: png, mime: "image/png", name: "again.png" }] } },
        ])
        await opted.session.inbox.cancel({ sessionID, inboxID: queued.id })

        // A ref whose blob is gone reaches opted-in clients as the same placeholder inline readers get.
        const gone = "e".repeat(64)
        const orphan = "d".repeat(64)
        const db = new Sqlite(database)
        db.run("INSERT INTO blob (hash, mime, bytes, data, time_created) VALUES (?, 'image/png', 3, ?, 1)", [
          orphan,
          Buffer.from("abc"),
        ])
        db.run(
          "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, 'user', 1001, 1001, 1001, ?)",
          [
            "msg_orphan_media",
            sessionID,
            JSON.stringify({
              text: "orphan",
              files: [{ uri: `media:${orphan}`, mime: "image/png", name: "gone.png", source: { type: "inline" } }],
              time: { created: 1001 },
            }),
          ],
        )
        db.run(
          "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, 'user', 1000, 1000, 1000, ?)",
          [
            "msg_gone_media",
            sessionID,
            JSON.stringify({
              text: "gone",
              files: [{ uri: `media:${gone}`, mime: "image/png", name: "gone.png", source: { type: "inline" } }],
              time: { created: 1000 },
            }),
          ],
        )
        db.close()
        const placeholder = {
          data: Buffer.from("[media unavailable: gone.png (image/png)]").toString("base64"),
          mime: "text/plain",
          source: { type: "inline" },
          name: "gone.png",
        }
        expect(await opted.session.message.get({ sessionID, messageID: "msg_gone_media" })).toMatchObject({
          files: [placeholder],
        })
        expect(await plain.session.message.get({ sessionID, messageID: "msg_gone_media" })).toMatchObject({
          files: [placeholder],
        })
        // A stored blob nothing references is not served by the route, so it is not offered as a ref either.
        expect((await handler(new Request(route(orphan)))).status).toBe(404)
        expect(await opted.session.message.get({ sessionID, messageID: "msg_orphan_media" })).toMatchObject({
          files: [placeholder],
        })
      })

      // Another server over the same database without the flag: opted-in clients get bytes, and the route still
      // serves what stored messages reference.
      const disabled = yield* serve(database, false)
      yield* Effect.promise(async () => {
        expect((await disabled(new Request(route(png)))).status).toBe(200)
        expect(
          (await client(disabled, "experimental-media-uri").message.list({ sessionID, order: "asc" })).data.slice(0, 2),
        ).toEqual([user, assistant])
        expect((await handler(new Request(route(png)))).status).toBe(200)
      })
    })
  }).pipe(Effect.scoped),
)

it.live("follows experimental.media_blob from the session's project config and serves only referenced blobs", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-media-project-")).path
    yield* Effect.gen(function* () {
      const database = path.join(dir, "opencode.db")
      const global = path.join(dir, "global")
      const project = path.join(dir, "project")
      yield* Effect.promise(async () => {
        await fs.mkdir(global, { recursive: true })
        await fs.mkdir(project, { recursive: true })
        await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ experimental: { media_blob: true } }))
      })
      // The flag lives only in the project's config; the server's cwd and global config leave it off.
      const handler = yield* ServerFetch.make({
        app: { version: "test" },
        database: { path: database },
        config: { directory: global, project: true, claude: false },
        models: { fetch: false },
        fs: { filewatcher: false },
      })
      const plain = client(handler)
      const opted = client(handler, "experimental-media-uri")

      yield* Effect.promise(async () => {
        const session = await plain.session.create({ location: { directory: project } })
        const queued = await opted.session.prompt({
          sessionID: session.id,
          text: "Look",
          files: [{ uri: `data:image/png;base64,${png}`, name: "shot.png" }],
          delivery: "queue",
          resume: false,
        })
        expect(await opted.session.inbox.list({ sessionID: session.id })).toMatchObject([
          { id: queued.id, payload: { files: [{ uri: media(png), mime: "image/png", name: "shot.png" }] } },
        ])
        expect(await plain.session.inbox.list({ sessionID: session.id })).toMatchObject([
          { id: queued.id, payload: { files: [{ data: png, mime: "image/png", name: "shot.png" }] } },
        ])
        expect((await handler(new Request(route(png)))).status).toBe(200)

        // A blob no message or inbox item references is unreadable, by route or as a prompt attachment.
        const db = new Sqlite(database)
        db.run("INSERT INTO blob (hash, mime, bytes, data, time_created) VALUES (?, 'text/plain', ?, ?, 1)", [
          hash(text),
          size(text),
          Buffer.from(text, "base64"),
        ])
        db.close()
        expect((await handler(new Request(route(text)))).status).toBe(404)
        const attached = await opted.session
          .prompt({ sessionID: session.id, text: "Steal", files: [{ uri: media(text) }], resume: false })
          .then(
            () => undefined,
            (error: unknown) => error,
          )
        expect(attached).toBeDefined()
        expect(await plain.session.inbox.list({ sessionID: session.id })).toHaveLength(1)
      })
    })
  }).pipe(Effect.scoped),
)
