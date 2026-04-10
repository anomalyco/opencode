import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { MessageID, type SessionID } from "../../../src/session/schema"
import { MessageV2 } from "../../../src/session/message-v2"
import { ModelID, ProviderID } from "../../../src/provider/schema"
import { aggregateSessionStats } from "../../../src/cli/cmd/stats"
import { Log } from "../../../src/util/log"
import { Database, eq } from "../../../src/storage/db"
import { SessionTable } from "../../../src/session/session.sql"

const projectRoot = path.join(__dirname, "../../..")
Log.init({ print: false })

const DAY = 24 * 60 * 60 * 1000

async function addMsg(sessionID: SessionID, created: number, cost: number) {
  await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "assistant",
    parentID: MessageID.ascending(),
    modelID: ModelID.make("test"),
    providerID: ProviderID.make("test"),
    mode: "",
    agent: "default",
    path: { cwd: "/", root: "/" },
    time: { created },
    cost,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageV2.Info)
}

function touch(sessionID: SessionID) {
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: Date.now() }).where(eq(SessionTable.id, sessionID)).run(),
  )
}

describe("aggregateSessionStats", () => {
  test("excludes messages older than the day window even when session was touched today", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const now = Date.now()

        await addMsg(session.id, now - 10 * DAY, 5.0)
        await addMsg(session.id, now, 1.0)
        touch(session.id)

        const stats = await aggregateSessionStats(1, "")

        expect(stats.totalCost).toBeCloseTo(1.0, 1)
        expect(stats.totalMessages).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("counts new messages added today to old sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const now = Date.now()

        await addMsg(session.id, now - 5 * DAY, 3.0)
        await addMsg(session.id, now, 2.0)
        touch(session.id)

        const stats = await aggregateSessionStats(1, "")

        expect(stats.totalCost).toBeCloseTo(2.0, 1)
        expect(stats.totalMessages).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("counts all messages when no day filter is set", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const now = Date.now()

        await addMsg(session.id, now - 10 * DAY, 5.0)
        await addMsg(session.id, now, 1.0)

        const stats = await aggregateSessionStats(undefined, "")

        expect(stats.totalCost).toBeCloseTo(6.0, 1)
        expect(stats.totalMessages).toBe(2)

        await Session.remove(session.id)
      },
    })
  })
})
