import { afterEach, describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { SessionRecovery } from "@/session/recovery"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = () =>
  LayerNode.compile(
    LayerNode.group([Database.node, EventV2Bridge.node, Session.node, SessionProjector.node]),
  )

const it = testEffect(layer())

const seedOrphan = Effect.fn("RecoveryTest.seedOrphan")(function* (input: {
  id: string
  sessionID: string
  created: number
  updated: number
}) {
  const { db } = yield* Database.Service
  const data = {
    id: input.id,
    sessionID: input.sessionID,
    parentID: "msg_" + input.id.slice(4) + "_parent",
    role: "assistant",
    mode: "build",
    agent: "build",
    providerID: "test",
    modelID: "test-model",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: input.created },
  }
  yield* db
    .insert(MessageTable)
    .values({
      id: input.id as never,
      session_id: input.sessionID as never,
      time_created: input.created,
      time_updated: input.updated,
      data: data as never,
    })
    .pipe(Effect.orDie)
})

const getRow = Effect.fn("RecoveryTest.getRow")(function* (id: string) {
  const { db } = yield* Database.Service
  return yield* db
    .select()
    .from(MessageTable)
    .where(eq(MessageTable.id, id as never))
    .get()
    .pipe(Effect.orDie)
})

describe("SessionRecovery.recover", () => {
  const setup = Effect.fn("RecoveryTest.setup")(function* () {
    const sessions = yield* Session.Service
    const { db } = yield* Database.Service
    const chat = yield* sessions.create({ title: "recovery" })
    return { sessions, db, sessionID: chat.id }
  })

  it.instance("finalizes orphaned assistant messages with an abort error", () =>
    Effect.gen(function* () {
      const { sessions, db, sessionID } = yield* setup()
      const stale = Date.now() - 120_000
      yield* seedOrphan({ id: "msg_rec_stale", sessionID, created: stale, updated: stale })

      yield* SessionRecovery.recover({ db, sessions })

      const row = yield* getRow("msg_rec_stale")
      const finalized = row?.data as { error?: { name?: string }; time?: { completed?: number } }
      expect(finalized.error?.name).toBe("MessageAbortedError")
      expect(finalized.time?.completed).toBeNumber()
    }),
  )

  it.instance("leaves recently active messages alone", () =>
    Effect.gen(function* () {
      const { sessions, db, sessionID } = yield* setup()
      const recent = Date.now() - 5_000
      yield* seedOrphan({ id: "msg_rec_live", sessionID, created: recent, updated: recent })

      yield* SessionRecovery.recover({ db, sessions })

      const row = yield* getRow("msg_rec_live")
      const data = row?.data as { error?: unknown; time?: { completed?: number } }
      expect(data.error).toBeUndefined()
      expect(data.time?.completed).toBeUndefined()
    }),
  )
})
