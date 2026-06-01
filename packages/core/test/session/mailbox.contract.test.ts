import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionMailbox } from "@opencode-ai/core/session/mailbox"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"

const tmp = new Array<string>()

afterEach(async () => {
  await Promise.all(tmp.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function makeDbPath() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-mailbox-test-"))
  tmp.push(dir)
  return join(dir, "mailbox.db")
}

function layer(filename: string) {
  return SessionMailbox.layer.pipe(
    Layer.provideMerge(EventV2.layer),
    Layer.provideMerge(Database.layerFromPath(filename)),
  )
}

function run<A, E>(filename: string, effect: Effect.Effect<A, E, Database.Service | EventV2.Service | SessionMailbox.Service>) {
  return Effect.runPromise(effect.pipe(Effect.provide(layer(filename)), Effect.scoped))
}

const sessionID = SessionSchema.ID.make("ses_mailbox_target")
const otherSessionID = SessionSchema.ID.make("ses_mailbox_other")

function seedSessions() {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    yield* db.run(sql`
      INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes)
      VALUES ('proj_mailbox', '/tmp/mailbox', 'mailbox', ${now}, ${now}, '[]')
    `)
    for (const id of [sessionID, otherSessionID]) {
      yield* db.run(sql`
        INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES (${id}, 'proj_mailbox', ${id}, '/tmp/mailbox', ${id}, 'test', ${now}, ${now})
      `)
    }
  })
}

describe("SessionMailbox contract", () => {
  test("preserves FIFO per target session and queue family", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSessions()
        const mailbox = yield* SessionMailbox.Service

        yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "first" })
        yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "second" })
        yield* mailbox.enqueue({ toSessionID: sessionID, kind: "control", delivery: "async", text: "control" })
        yield* mailbox.enqueue({ toSessionID: otherSessionID, kind: "user", delivery: "async", text: "other" })

        const first = yield* mailbox.claim({ toSessionID: sessionID, kind: "user", limit: 1, claimID: "claim-a" })
        const second = yield* mailbox.claim({ toSessionID: sessionID, kind: "user", limit: 1, claimID: "claim-b" })
        const control = yield* mailbox.claim({ toSessionID: sessionID, kind: "control", limit: 1, claimID: "claim-c" })

        expect(first.map((message) => message.text)).toEqual(["first"])
        expect(second.map((message) => message.text)).toEqual(["second"])
        expect(control.map((message) => message.text)).toEqual(["control"])
      }),
    )
  })

  test("atomically claims queued messages so concurrent runners cannot double-deliver", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSessions()
        const mailbox = yield* SessionMailbox.Service
        yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "only once" })

        const results = yield* Effect.all(
          [
            mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "runner-1" }),
            mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "runner-2" }),
          ],
          { concurrency: "unbounded" },
        )

        const claimed = results.flat()
        expect(claimed.map((message) => message.text)).toEqual(["only once"])
        expect(new Set(claimed.map((message) => message.id)).size).toBe(1)
      }),
    )
  })

  test("keeps queued mailbox messages out of transcript state until runner delivery", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSessions()
        const mailbox = yield* SessionMailbox.Service
        const { db } = yield* Database.Service
        const observed = new Array<string>()
        const events = yield* EventV2.Service
        yield* events.listen((event) => Effect.sync(() => observed.push(event.type)))

        const queued = yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "not transcript" })

        expect(queued.state).toBe("queued")
        expect(yield* db.select().from(SessionMessageTable).all()).toEqual([])
        expect(observed).toContain(SessionEvent.Mailbox.Enqueued.type)
        expect(observed).not.toContain("session.next.prompted")
      }),
    )
  })

  test("makes cancellation and terminal delivery transitions idempotent", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSessions()
        const mailbox = yield* SessionMailbox.Service

        const cancellable = yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "cancel" })
        expect((yield* mailbox.cancel(cancellable.id)).state).toBe("cancelled")
        expect((yield* mailbox.cancel(cancellable.id)).state).toBe("cancelled")
        expect(yield* mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "cancelled-claim" })).toEqual([])

        const deliverable = yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "deliver" })
        const [processing] = yield* mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "deliver-claim" })
        expect(processing?.id).toBe(deliverable.id)
        expect((yield* mailbox.delivered(deliverable.id)).state).toBe("delivered")
        expect((yield* mailbox.delivered(deliverable.id)).state).toBe("delivered")
        expect((yield* mailbox.failed({ id: deliverable.id, error: "late" })).state).toBe("delivered")
        expect(yield* mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "deliver-claim" })).toEqual([])

        const fail = yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "fail" })
        yield* mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "fail-claim" })
        expect((yield* mailbox.failed({ id: fail.id, error: "boom" })).state).toBe("failed")
        expect((yield* mailbox.failed({ id: fail.id, error: "again" })).state).toBe("failed")
        expect((yield* mailbox.cancel(fail.id)).state).toBe("failed")
        expect(yield* mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "fail-claim" })).toEqual([])
      }),
    )
  })

  test("recovers durable queued and processing rows after service rebind", async () => {
    const dbPath = await makeDbPath()
    await run(
      dbPath,
      Effect.gen(function* () {
        yield* seedSessions()
        const mailbox = yield* SessionMailbox.Service
        yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "queued" })
        yield* mailbox.enqueue({ toSessionID: sessionID, kind: "user", delivery: "async", text: "processing" })
        yield* mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "rebind-processing" })
      }),
    )

    await run(
      dbPath,
      Effect.gen(function* () {
        const mailbox = yield* SessionMailbox.Service
        const rows = yield* mailbox.list({ toSessionID: sessionID })
        expect(rows.map((message) => [message.text, message.state])).toEqual([
          ["queued", "processing"],
          ["processing", "queued"],
        ])
        expect(yield* mailbox.claim({ toSessionID: sessionID, kind: "user", claimID: "rebind-processing" })).toHaveLength(1)
      }),
    )
  })
})
