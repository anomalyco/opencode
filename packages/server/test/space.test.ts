import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const authorization = `Basic ${btoa("opencode:secret")}`

const client = (handler: (request: Request) => Promise<Response>, headers?: Record<string, string>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    headers,
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

// Reads the wire stream directly: the SDK's shared event subscription has no `experimental.space` option.
const subscribe = async (
  handler: (request: Request) => Promise<Response>,
  query: string,
  headers: Record<string, string> = { authorization },
) => {
  const response = await handler(new Request(`http://opencode.local/api/event?${query}`, { headers }))
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
  const frames: string[] = []
  let buffer = ""
  return {
    status: response.status,
    next: async (): Promise<{ readonly type: string; readonly data: unknown }> => {
      while (frames.length === 0) {
        const chunk = await reader?.read()
        if (!chunk || chunk.done) throw new Error("event stream closed")
        const parts = (buffer + chunk.value).split("\n\n")
        buffer = parts.pop() ?? ""
        frames.push(...parts.filter((part) => part.startsWith("data: ")))
      }
      const event = JSON.parse(frames.shift()?.slice("data: ".length) ?? "")
      return { type: event.type, data: event.data }
    },
    close: () => reader?.cancel(),
  }
}

it.live("syncs a space through the API and follows it on the event stream, across a restart", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-space-api-")).path
    const boot = ServerFetch.make({
      app: { version: "test" },
      password: "secret",
      database: { path: path.join(dir, "opencode.db") },
      config: {
        directory: dir,
        project: false,
        claude: false,
        content: "{}",
      },
      models: { fetch: false },
      fs: { filewatcher: false },
    })

    // Issued by the database, so it survives the restart below.
    let epoch = ""
    let cursor = ""
    yield* Effect.scoped(
      Effect.gen(function* () {
        const handler = yield* boot
        const writer = client(handler, { authorization })
        yield* Effect.promise(async () => {
          // A stream that subscribes to no space still connects at once and gets its other events.
          const plain = await subscribe(handler, "types=session.created")
          const connected = await plain.next()
          expect(connected.type).toBe("server.connected")
          const stream = (connected.data as { stream: string }).stream
          expect(stream).toMatch(/^[0-9a-f-]{36}$/u)
          await writer.session.create({ location: { directory: dir } })
          expect((await plain.next()).type).toBe("session.created")

          await writer.experimental.space.set({ space: "app", key: "draft/1", value: '{"text":"hi","n":[1,null]}' })
          await writer.experimental.space.set({ space: "other", key: "draft/1", value: "elsewhere" })
          const reader = await subscribe(handler, "types=session.created")
          const readerStream = ((await reader.next()).data as { stream: string }).stream
          expect(readerStream).not.toBe(stream)
          const page = await writer.experimental.space.sync({ space: "app" })
          epoch = page.epoch
          expect(page).toEqual({
            type: "snapshot",
            space: "app",
            epoch,
            revision: 1,
            entries: [{ key: "draft/1", value: '{"text":"hi","n":[1,null]}' }],
            cursor: `${epoch}.1`,
          })
          // Between the sync and the subscription.
          await writer.experimental.space.set({ space: "app", key: "draft/2", value: "2" })
          await writer.experimental.space.subscribe({
            stream: readerStream,
            spaces: [{ space: "app", cursor: page.cursor }],
          })
          expect(await reader.next()).toEqual({
            type: "experimental.space.updated",
            data: { space: "app", key: "draft/2", value: "2", revision: 2 },
          })
          await writer.experimental.space.set({ space: "other", key: "draft/1", value: "unseen" })
          await writer.experimental.space.delete({ space: "app", key: "draft/1" })
          await writer.session.create({ location: { directory: dir } })
          expect(await reader.next()).toEqual({
            type: "experimental.space.deleted",
            data: { space: "app", key: "draft/1", revision: 3 },
          })
          expect((await reader.next()).type).toBe("session.created")
          // The stream that subscribed to nothing sees no space events at all.
          expect((await plain.next()).type).toBe("session.created")
          // Unsubscribing a space the stream does not follow succeeds.
          await writer.experimental.space.unsubscribe({ stream, spaces: ["never"] })
          await reader.close()
          await plain.close()
          cursor = `${epoch}.3`

          // A closed stream, or one that never existed, cannot be subscribed.
          await expect(
            writer.experimental.space.subscribe({ stream: readerStream, spaces: [{ space: "app", cursor }] }),
          ).rejects.toMatchObject({ _tag: "InvalidRequestError", kind: "stream_not_found", field: "stream" })
          await expect(
            writer.experimental.space.subscribe({ stream: "not-a-stream", spaces: [] }),
          ).rejects.toMatchObject({ _tag: "InvalidRequestError", kind: "stream_not_found", field: "stream" })
          await expect(
            writer.experimental.space.unsubscribe({ stream: "not-a-stream", spaces: ["app"] }),
          ).rejects.toMatchObject({ _tag: "InvalidRequestError", kind: "stream_not_found", field: "stream" })

          // Offline: repeated updates, a key created and deleted, and deletes of already deleted keys.
          await writer.experimental.space.set({ space: "app", key: "draft/2", value: "3" })
          await writer.experimental.space.set({ space: "app", key: "draft/2", value: "4" })
          await writer.experimental.space.set({ space: "app", key: "draft/3", value: "x" })
          await writer.experimental.space.delete({ space: "app", key: "draft/3" })
          await writer.experimental.space.delete({ space: "app", key: "draft/3" })
          await writer.experimental.space.delete({ space: "app", key: "draft/1" })
          expect(await writer.experimental.space.sync({ space: "app", cursor })).toEqual({
            type: "delta",
            space: "app",
            epoch,
            revision: 7,
            entries: [{ key: "draft/2", value: "4" }],
            deleted: ["draft/3"],
            cursor: `${epoch}.7`,
          })
          cursor = `${epoch}.7`

          const anonymous = client(handler)
          for (const call of [
            () => anonymous.experimental.space.set({ space: "app", key: "x", value: "1" }),
            () => anonymous.experimental.space.sync({ space: "app" }),
            () => anonymous.experimental.space.subscribe({ stream, spaces: [] }),
            () => anonymous.experimental.space.unsubscribe({ stream, spaces: [] }),
          ])
            await expect(call()).rejects.toMatchObject({ _tag: "UnauthorizedError" })
          expect((await subscribe(handler, "", {})).status).toBe(401)
          const empty = await handler(
            new Request("http://opencode.local/api/experimental/space/app/c", {
              method: "PUT",
              headers: { authorization, "content-type": "application/json" },
              body: JSON.stringify({ value: null }),
            }),
          )
          expect(empty.status).toBe(400)
          // The cap is the value's UTF-8 length: exactly 1 MiB is stored, one byte more is not. In its own space, so
          // the revisions above are unchanged.
          const put = (space: string, value: string) =>
            handler(
              new Request(`http://opencode.local/api/experimental/space/${space}/c`, {
                method: "PUT",
                headers: { authorization, "content-type": "application/json" },
                body: JSON.stringify({ value }),
              }),
            )
          expect((await put("limit", "x".repeat(1024 * 1024))).status).toBe(204)
          expect((await put("limit", "x".repeat(1024 * 1024 + 1))).status).toBe(400)
        })
      }),
    )

    const handler = yield* boot
    yield* Effect.promise(async () => {
      const writer = client(handler, { authorization })
      const reader = await subscribe(handler, "types=session.created")
      const stream = ((await reader.next()).data as { stream: string }).stream
      await writer.experimental.space.set({ space: "app", key: "draft/4", value: "true" })
      // A new stream after the restart subscribes with the cursor saved before it.
      await writer.experimental.space.subscribe({ stream, spaces: [{ space: "app", cursor }] })
      expect(await reader.next()).toEqual({
        type: "experimental.space.updated",
        data: { space: "app", key: "draft/4", value: "true", revision: 8 },
      })
      await writer.experimental.space.delete({ space: "app", key: "draft/4" })
      expect(await reader.next()).toEqual({
        type: "experimental.space.deleted",
        data: { space: "app", key: "draft/4", revision: 9 },
      })
      await reader.close()

      // A reset, as after a restore, makes every saved cursor unusable; only an authenticated client may do it.
      await expect(client(handler).experimental.space.reset()).rejects.toMatchObject({ _tag: "UnauthorizedError" })
      await writer.experimental.space.reset()
      const reset = await writer.experimental.space.sync({ space: "app", cursor })
      expect(reset.type).toBe("snapshot")
      expect(reset.epoch).not.toBe(epoch)
    })
  }).pipe(Effect.scoped),
)

it.live("two clients follow one space on their own streams, through unsubscribe and a reconnect", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-space-clients-")).path
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      password: "secret",
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: dir, project: false, claude: false, content: "{}" },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    yield* Effect.promise(async () => {
      const api = client(handler, { authorization })
      const updated = (key: string, value: string, revision: number) => ({
        type: "experimental.space.updated",
        data: { space: "pins", key, value, revision },
      })
      const deleted = (key: string, revision: number) => ({
        type: "experimental.space.deleted",
        data: { space: "pins", key, revision },
      })
      // Each client opens its own stream and reads its ID, then syncs unless it has a saved cursor, and subscribes.
      const follow = async (saved?: string) => {
        const events = await subscribe(handler, "types=session.created")
        const stream = ((await events.next()).data as { stream: string }).stream
        const page = saved === undefined ? await api.experimental.space.sync({ space: "pins" }) : undefined
        await api.experimental.space.subscribe({
          stream,
          spaces: [{ space: "pins", cursor: saved ?? page?.cursor ?? "" }],
        })
        return { events, stream, page }
      }

      const a = await follow()
      const b = await follow()
      expect(a.stream).not.toBe(b.stream)
      const epoch = a.page?.epoch ?? ""
      for (const page of [a.page, b.page])
        expect(page).toEqual({ type: "snapshot", space: "pins", epoch, revision: 0, entries: [], cursor: `${epoch}.0` })

      await api.experimental.space.set({ space: "pins", key: "x", value: "1" })
      expect([await a.events.next(), await b.events.next()]).toEqual([updated("x", "1", 1), updated("x", "1", 1)])
      await api.experimental.space.delete({ space: "pins", key: "x" })
      expect([await a.events.next(), await b.events.next()]).toEqual([deleted("x", 2), deleted("x", 2)])
      await api.experimental.space.set({ space: "pins", key: "y", value: "2" })
      expect([await a.events.next(), await b.events.next()]).toEqual([updated("y", "2", 3), updated("y", "2", 3)])

      // B stops following pins: A still gets z, and B's next event is the session created after it.
      await api.experimental.space.unsubscribe({ stream: b.stream, spaces: ["pins"] })
      await api.experimental.space.set({ space: "pins", key: "z", value: "3" })
      await api.session.create({ location: { directory: dir } })
      expect(await a.events.next()).toEqual(updated("z", "3", 4))
      expect((await a.events.next()).type).toBe("session.created")
      expect((await b.events.next()).type).toBe("session.created")

      // B goes away; A changes more; B comes back on a new stream with the cursor of the last change it applied.
      await b.events.close()
      await api.experimental.space.set({ space: "pins", key: "a", value: "4" })
      await api.experimental.space.set({ space: "pins", key: "b", value: "5" })
      await api.experimental.space.delete({ space: "pins", key: "a" })
      const back = await follow(`${epoch}.3`)
      expect(back.stream).not.toBe(b.stream)
      await api.experimental.space.set({ space: "pins", key: "c", value: "6" })
      // What it missed, one event per key in revision order, then the live change.
      expect([
        await back.events.next(),
        await back.events.next(),
        await back.events.next(),
        await back.events.next(),
      ]).toEqual([updated("z", "3", 4), updated("b", "5", 6), deleted("a", 7), updated("c", "6", 8)])

      // A fresh client with no cursor gets the final state as a snapshot.
      expect(await api.experimental.space.sync({ space: "pins" })).toEqual({
        type: "snapshot",
        space: "pins",
        epoch,
        revision: 8,
        entries: [
          { key: "y", value: "2" },
          { key: "z", value: "3" },
          { key: "b", value: "5" },
          { key: "c", value: "6" },
        ],
        cursor: `${epoch}.8`,
      })
      await a.events.close()
      await back.events.close()
    })
  }).pipe(Effect.scoped),
)
