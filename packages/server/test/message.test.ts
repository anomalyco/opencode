import { createHash } from "node:crypto"
import { expect } from "bun:test"
import { OpenCode, type SessionMessageInfo } from "@opencode/client"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionMediaBlob } from "@opencode/core/session/media-blob"
import { SessionMessage } from "@opencode/core/session/message"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { InstructionStateTable, SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { ProjectTable } from "@opencode/core/project/sql"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Model } from "@opencode/schema/model"
import { Session } from "@opencode/schema/session"
import { DateTime, Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const messages: SessionMessageInfo[] = [
  { id: "msg_z", type: "user", text: "First request", time: { created: 300 } },
  {
    id: "msg_assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "test" },
    content: [{ type: "text", text: "First answer" }],
    finish: "stop",
    time: { created: 400, completed: 500 },
  },
  { id: "msg_b", type: "user", text: "Second request", time: { created: 100 } },
  { id: "msg_synthetic", type: "synthetic", text: "Background completion", time: { created: 200 } },
  {
    id: "msg_compaction",
    type: "compaction",
    status: "completed",
    reason: "manual",
    summary: "Conversation summary",
    time: { created: 700 },
  },
  { id: "msg_x", type: "user", text: "Third request", time: { created: 600 } },
  { id: "msg_system", type: "system", text: "Updated instructions", time: { created: 800 } },
  { id: "msg_a", type: "user", text: "Fourth request", time: { created: 500 } },
  { id: "msg_idle", type: "idle", outcome: "succeeded", time: { created: 900 } },
]

const setup = Effect.gen(function* () {
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    config: { project: false },
    models: { fetch: false },
    fs: { filewatcher: false },
  })
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })
  const session = yield* Effect.promise(async () => {
    const template = await api.session.create({ title: "Message filtering" })
    return api.session.import({ info: { ...template, id: Session.ID.create() }, messages })
  })
  return { api, handler, sessionID: session.id }
})

it.live("filters message types before paginating in either direction through the generated client", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    yield* Effect.promise(async () => {
      const input = { sessionID: fixture.sessionID, type: "user", limit: 2 } as const
      // Omission retains the full transcript, in durable sequence rather than timestamp or ID order.
      expect(
        (await fixture.api.message.list({ sessionID: fixture.sessionID })).data.map((message) => message.id),
      ).toEqual(messages.toReversed().map((message) => message.id))
      for (const order of ["asc", "desc"] as const) {
        const ids = order === "asc" ? ["msg_z", "msg_b", "msg_x", "msg_a"] : ["msg_a", "msg_x", "msg_b", "msg_z"]
        const first = await fixture.api.message.list({ ...input, order })
        expect(first.data.map((message) => message.id)).toEqual(ids.slice(0, 2))
        if (!first.cursor.next) throw new Error("Expected a next cursor")
        const second = await fixture.api.message.list({ ...input, cursor: first.cursor.next })
        expect(second.data.map((message) => message.id)).toEqual(ids.slice(2))
        if (!second.cursor.previous || !second.cursor.next) throw new Error("Expected previous and next cursors")
        const previous = await fixture.api.message.list({ ...input, cursor: second.cursor.previous })
        expect(previous.data).toEqual(first.data)
        const end = await fixture.api.message.list({ ...input, cursor: second.cursor.next })
        expect(end).toEqual({ data: [], cursor: { previous: null, next: null } })
      }
      expect((await fixture.api.message.list({ sessionID: fixture.sessionID, type: "compaction" })).data).toEqual([
        messages[4],
      ])
      expect(
        (await fixture.api.message.list({ sessionID: fixture.sessionID, type: "assistant", limit: 1 })).data,
      ).toEqual([messages[1]])
      expect((await fixture.api.message.list({ sessionID: fixture.sessionID, type: "idle" })).data).toEqual([
        messages[8],
      ])
      expect((await fixture.api.message.list({ sessionID: fixture.sessionID, type: "shell" })).data).toEqual([])
    })
  }),
)

it.live("rejects unknown message type filters at the HTTP boundary", () =>
  Effect.gen(function* () {
    const fixture = yield* setup
    yield* Effect.promise(async () => {
      for (const type of ["unknown", "tool", "User", ""]) {
        const response = await fixture.handler(
          new Request(`http://opencode.local/api/session/${fixture.sessionID}/message?type=${type}`),
        )
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ _tag: "InvalidRequestError" })
      }
    })
  }),
)

it.live(
  "switches attachment wire shape on X-OpenCode-Capabilities: media-uri, serves /api/media/:hash with XSS protections + ETag + 304, and enforces bytes on import and the LLM path",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      SessionMediaBlob.configure({ enabled: true })
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      const pngBytes = Buffer.from(pngBase64, "base64")
      const pngHash = createHash("sha256").update(pngBytes).digest("hex")
      const mediaUri = `/api/media/${pngHash}`

      const fileBytes = Buffer.from("workspace file contents")
      const fileBase64 = fileBytes.toString("base64")
      const fileHash = createHash("sha256").update(fileBytes).digest("hex")
      const fileMediaUri = `/api/media/${fileHash}`

      const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
      const svgBase64 = svgBytes.toString("base64")
      const svgHash = createHash("sha256").update(svgBytes).digest("hex")
      const svgMediaUri = `/api/media/${svgHash}`

      const htmlBytes = Buffer.from("<!doctype html><script>alert(1)</script>")
      const htmlBase64 = htmlBytes.toString("base64")
      const htmlHash = createHash("sha256").update(htmlBytes).digest("hex")
      const htmlMediaUri = `/api/media/${htmlHash}`

      const sessionID = Session.ID.create()
      const mediaApi = OpenCode.make({
        baseUrl: "http://opencode.local",
        headers: { "X-OpenCode-Capabilities": "media-uri" },
        fetch: Object.assign(
          (input: string | URL | Request, init?: RequestInit) => fixture.handler(new Request(input, init)),
          {
            preconnect: fetch.preconnect,
          },
        ),
      })

      try {
        yield* Effect.promise(async () => {
          const template = await fixture.api.session.create({ title: "Media wire test" })

          // session.import must reject media-uri attachments that lack inline base64 data
          const invalidImport = await fixture.handler(
            new Request("http://opencode.local/api/experimental/session/import", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                info: { ...template, id: Session.ID.create() },
                messages: [
                  {
                    id: "msg_invalid_import",
                    type: "user",
                    text: "Missing bytes",
                    files: [{ uri: mediaUri, mime: "image/png", name: "shot.png" }],
                    time: { created: 100 },
                  },
                ],
              }),
            }),
          )
          expect(invalidImport.status).toBe(400)

          await fixture.api.session.import({
            info: { ...template, id: sessionID },
            messages: [
              {
                id: "msg_media_user",
                type: "user",
                text: "See attached",
                files: [
                  {
                    data: pngBase64,
                    mime: "image/png",
                    source: { type: "inline" },
                    name: "shot.png",
                  },
                  {
                    data: fileBase64,
                    mime: "text/plain",
                    source: { type: "uri", uri: "file:///workspace/readme.txt" },
                    name: "readme.txt",
                  },
                  {
                    data: svgBase64,
                    mime: "image/svg+xml",
                    source: { type: "inline" },
                    name: "xss.svg",
                  },
                  {
                    data: htmlBase64,
                    mime: "text/html",
                    source: { type: "inline" },
                    name: "xss.html",
                  },
                ],
                time: { created: 100 },
              },
              {
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
                      content: [
                        {
                          type: "file",
                          uri: `data:image/png;base64,${pngBase64}`,
                          mime: "image/png",
                          name: "shot.png",
                        },
                      ],
                    },
                    time: { created: 110, ran: 111, completed: 112 },
                  },
                ],
                finish: "stop",
                time: { created: 110, completed: 120 },
              },
            ],
          })

          // 1. Without header: legacy shape asserted with full-object toEqual (no extra uri/origin/width/height/bytes fields)
          const legacyList = await fixture.api.message.list({ sessionID, order: "asc" })
          const legacyUser = legacyList.data[0]
          const legacyAssistant = legacyList.data[1]
          expect(legacyUser).toEqual({
            id: "msg_media_user",
            type: "user",
            text: "See attached",
            files: [
              {
                data: pngBase64,
                mime: "image/png",
                source: { type: "inline" },
                name: "shot.png",
              },
              {
                data: fileBase64,
                mime: "text/plain",
                source: { type: "uri", uri: "file:///workspace/readme.txt" },
                name: "readme.txt",
              },
              {
                data: svgBase64,
                mime: "image/svg+xml",
                source: { type: "inline" },
                name: "xss.svg",
              },
              {
                data: htmlBase64,
                mime: "text/html",
                source: { type: "inline" },
                name: "xss.html",
              },
            ],
            time: { created: 100 },
          })
          expect(legacyAssistant).toEqual({
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
                  content: [
                    {
                      type: "file",
                      uri: `data:image/png;base64,${pngBase64}`,
                      mime: "image/png",
                      name: "shot.png",
                    },
                  ],
                },
                time: { created: 110, ran: 111, completed: 112 },
              },
            ],
            finish: "stop",
            time: { created: 110, completed: 120 },
          })

          // 2. With X-OpenCode-Capabilities: media-uri: URI + dimensions/bytes, no data, file:// source moved to origin
          const uriList = await mediaApi.message.list({ sessionID, order: "asc" })
          const uriUser: unknown = uriList.data[0]
          const uriAssistant: unknown = uriList.data[1]
          expect(uriUser).toEqual({
            id: "msg_media_user",
            type: "user",
            text: "See attached",
            files: [
              {
                uri: mediaUri,
                mime: "image/png",
                width: 1,
                height: 1,
                bytes: pngBytes.byteLength,
                name: "shot.png",
              },
              {
                uri: fileMediaUri,
                mime: "text/plain",
                bytes: fileBytes.byteLength,
                origin: { type: "uri", uri: "file:///workspace/readme.txt" },
                name: "readme.txt",
              },
              {
                uri: svgMediaUri,
                mime: "image/svg+xml",
                bytes: svgBytes.byteLength,
                name: "xss.svg",
              },
              {
                uri: htmlMediaUri,
                mime: "text/html",
                bytes: htmlBytes.byteLength,
                name: "xss.html",
              },
            ],
            time: { created: 100 },
          })
          expect(uriAssistant).toEqual({
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
                  content: [
                    {
                      type: "file",
                      uri: mediaUri,
                      mime: "image/png",
                      width: 1,
                      height: 1,
                      bytes: pngBytes.byteLength,
                      name: "shot.png",
                    },
                  ],
                },
                time: { created: 110, ran: 111, completed: 112 },
              },
            ],
            finish: "stop",
            time: { created: 110, completed: 120 },
          })

          // Single message & context also respect the header and export always keeps inline data
          const singleUri = await mediaApi.session.message.get({ sessionID, messageID: "msg_media_user" })
          if (singleUri.type === "user") {
            const first = singleUri.files?.[0]
            expect(first && "uri" in first ? first.uri : undefined).toBe(mediaUri)
            expect(first && "data" in first ? first.data : undefined).toBeUndefined()
          }
          const contextUri = await mediaApi.session.context({ sessionID })
          const contextUser = contextUri.find((m) => m.id === "msg_media_user")
          if (contextUser?.type === "user") {
            const first = contextUser.files?.[0]
            expect(first && "uri" in first ? first.uri : undefined).toBe(mediaUri)
            expect(first && "data" in first ? first.data : undefined).toBeUndefined()
          }
          const exported = await mediaApi.session.export({ sessionID })
          const exportedUser = exported.messages.find((m) => m.id === "msg_media_user")
          if (exportedUser?.type === "user") {
            const first = exportedUser.files?.[0]
            expect(first && "data" in first ? first.data : undefined).toBe(pngBase64)
            expect(first && "source" in first ? first.source : undefined).toEqual({ type: "inline" })
          }

          // Re-admitting via /api/media/<hash> URI on session.prompt works and respects header on response
          const admitted = await mediaApi.session.prompt({
            sessionID,
            text: "Re-submitted from revert/queue",
            files: [{ uri: mediaUri, name: "reverted.png" }],
            delivery: "queue",
            resume: false,
          })
          if (admitted.type === "user") {
            const firstAdmitted: unknown = admitted.payload.files?.[0]
            expect(firstAdmitted).toEqual({
              uri: mediaUri,
              mime: "image/png",
              width: 1,
              height: 1,
              bytes: pngBytes.byteLength,
              name: "reverted.png",
            })
          }

          // 3. GET /api/media/:hash returns raw bytes, ETag, Cache-Control, security headers, and 304 on If-None-Match
          const mediaResponse = await fixture.handler(new Request(`http://opencode.local${mediaUri}`))
          expect(mediaResponse.status).toBe(200)
          expect(mediaResponse.headers.get("content-type")).toBe("image/png")
          expect(mediaResponse.headers.get("content-disposition")).toBeNull()
          expect(mediaResponse.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
          expect(mediaResponse.headers.get("etag")).toBe(`"${pngHash}"`)
          expect(mediaResponse.headers.get("x-content-type-options")).toBe("nosniff")
          expect(mediaResponse.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox")
          expect(Buffer.from(await mediaResponse.arrayBuffer()).equals(pngBytes)).toBe(true)

          // Stored XSS defense: SVG and HTML payloads are served as application/octet-stream attachments with nosniff + sandbox CSP
          for (const [uri, expectedBytes] of [
            [svgMediaUri, svgBytes],
            [htmlMediaUri, htmlBytes],
          ] as const) {
            const unsafeResponse = await fixture.handler(new Request(`http://opencode.local${uri}`))
            expect(unsafeResponse.status).toBe(200)
            expect(unsafeResponse.headers.get("content-type")).toBe("application/octet-stream")
            expect(unsafeResponse.headers.get("content-disposition")).toBe("attachment")
            expect(unsafeResponse.headers.get("x-content-type-options")).toBe("nosniff")
            expect(unsafeResponse.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox")
            expect(Buffer.from(await unsafeResponse.arrayBuffer()).equals(expectedBytes)).toBe(true)
          }

          const notModified = await fixture.handler(
            new Request(`http://opencode.local${mediaUri}`, {
              headers: { "If-None-Match": `"${pngHash}"` },
            }),
          )
          expect(notModified.status).toBe(304)
          expect(notModified.headers.get("etag")).toBe(`"${pngHash}"`)
          expect(notModified.headers.get("x-content-type-options")).toBe("nosniff")
          expect(notModified.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox")
          expect((await notModified.arrayBuffer()).byteLength).toBe(0)

          // Hashes not matching ^[0-9a-f]{64}$ are rejected with 400; missing 64-hex hashes return 404
          for (const invalidHash of ["deadbeef", "A".repeat(64), "g".repeat(64), `${"a".repeat(63)}!`]) {
            const bad = await fixture.handler(new Request(`http://opencode.local/api/media/${invalidHash}`))
            expect(bad.status).toBe(400)
          }
          const missingMedia = await fixture.handler(new Request(`http://opencode.local/api/media/${"0".repeat(64)}`))
          expect(missingMedia.status).toBe(404)

          // 4. Generated client media.get returns Uint8Array, and rehydrating before inbox.cancel survives blob sweep on undo + resend
          const fetchedBytes = await mediaApi.media.get({ hash: pngHash })
          expect(Buffer.from(fetchedBytes).equals(pngBytes)).toBe(true)

          const undoBytes = Buffer.concat([pngBytes, Buffer.from("undo-only-image")])
          const undoBase64 = undoBytes.toString("base64")
          const undoHash = createHash("sha256").update(undoBytes).digest("hex")
          const undoUri = `/api/media/${undoHash}`
          const queuedUndo = await mediaApi.session.prompt({
            sessionID,
            text: "Queued then undone",
            files: [{ uri: `data:image/png;base64,${undoBase64}`, name: "undo.png" }],
            delivery: "queue",
            resume: false,
          })
          const rehydratedUndoBytes = await mediaApi.media.get({ hash: undoHash })
          await mediaApi.session.inbox.cancel({ sessionID, inboxID: queuedUndo.id })
          // After inbox.cancel sweeps the unreferenced blob, /api/media/<undoHash> is 404
          const sweptResponse = await fixture.handler(new Request(`http://opencode.local${undoUri}`))
          expect(sweptResponse.status).toBe(404)
          // Resending from the rehydrated data: URL succeeds and restores the blob
          const resent = await mediaApi.session.prompt({
            sessionID,
            text: "Resent after undo",
            files: [
              {
                uri: `data:image/png;base64,${Buffer.from(rehydratedUndoBytes).toString("base64")}`,
                name: "undo.png",
              },
            ],
            delivery: "queue",
            resume: false,
          })
          if (resent.type === "user") {
            const firstResent: unknown = resent.payload.files?.[0]
            expect(firstResent).toMatchObject({ uri: undoUri, mime: "image/png", name: "undo.png" })
          }
          const restoredResponse = await fixture.handler(new Request(`http://opencode.local${undoUri}`))
          expect(restoredResponse.status).toBe(200)
        })

        // 5. LLM path (entriesForRunner -> toLLMMessages) always gets rehydrated bytes even under MediaUriCapability=true,
        // and toLLMMessages dies if an unrehydrated media ref ever reaches it.
        const model = Model.Ref.parse("test/test")
        expect(() =>
          toLLMMessages(
            [
              {
                id: SessionMessage.ID.make("msg_unrehydrated_defect"),
                type: "user",
                text: "broken",
                files: [{ uri: mediaUri, mime: "image/png", name: "shot.png" }] as unknown as SessionMessage.User["files"],
                time: { created: DateTime.makeUnsafe(1) },
              },
            ],
            model,
          ),
        ).toThrow(/unrehydrated media attachment/)

        const localCheck = Effect.gen(function* () {
          const { db } = yield* Database.Service
          const projectID = Project.ID.make("prj_media_llm")
          const importedSession = Session.ID.create()
          yield* db
            .insert(ProjectTable)
            .values({ id: projectID, worktree: AbsolutePath.make("/tmp/media-llm"), sandboxes: [] })
            .run()
            .pipe(Effect.orDie)
          yield* db
            .insert(SessionTable)
            .values({
              id: importedSession,
              project_id: projectID,
              directory: "/tmp/media-llm",
              slug: "media-llm",
              title: "Media LLM",
              version: "test",
            })
            .run()
            .pipe(Effect.orDie)
          const externalized = yield* SessionMediaBlob.externalize(db, {
            text: "Check LLM hydration",
            files: [
              { data: pngBase64, mime: "image/png", source: { type: "inline" as const }, name: "shot.png" },
              {
                data: fileBase64,
                mime: "text/plain",
                source: { type: "uri" as const, uri: "file:///workspace/readme.txt" },
                name: "readme.txt",
              },
            ],
            time: { created: 1 },
          })
          yield* db
            .insert(SessionMessageTable)
            .values({
              id: SessionMessage.ID.make("msg_llm_media"),
              session_id: importedSession,
              type: "user",
              seq: 1,
              time_created: 1,
              data: externalized,
            })
            .run()
            .pipe(Effect.orDie)

          yield* db
            .insert(InstructionStateTable)
            .values({
              session_id: importedSession,
              epoch_start: 0,
              through_seq: 0,
              initial_values: {},
              current_values: {},
            })
            .run()
            .pipe(Effect.orDie)

          const runner = yield* SessionHistory.entriesForRunner(
            db,
            importedSession,
            [],
            model,
          ).pipe(SessionMediaBlob.withMediaUri(true))
          expect(runner.entries).toHaveLength(1)
          const llmMessages = toLLMMessages(
            runner.entries.map((entry) => entry.message),
            model,
          )
          expect(JSON.stringify(llmMessages)).toContain(pngBase64)
          expect(JSON.stringify(llmMessages)).toContain("workspace file contents")
        }).pipe(Effect.provide(AppNodeBuilder.build(Database.node)))
        yield* localCheck
      } finally {
        SessionMediaBlob.configure({ enabled: false })
      }
    }),
)
