import { describe, expect, test, mock } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { WeaveEpisode, WeaveThread } from "../../src/session/weave"
import { SessionWeaveCommand } from "../../src/cli/cmd/session"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session weave command", () => {
  test("prints summary by default and full state with --full", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({ title: "weave-cli-contract" })
        const dispatch = await WeaveThread.dispatch({
          sessionID: session.id,
          parentSessionID: session.id,
          action: "dispatch-thread-e2e",
          role: "thread",
        })
        await WeaveEpisode.create({
          sessionID: session.id,
          threadID: dispatch.threadID,
          summary: "episode-e2e",
          sourceMessageIDs: [],
        })

        const logSpy = mock(() => {})
        const original = console.log
        console.log = logSpy as typeof console.log
        try {
          await SessionWeaveCommand.handler!({ sessionID: session.id, full: false } as any)
          await SessionWeaveCommand.handler!({ sessionID: session.id, full: true } as any)
        } finally {
          console.log = original
        }

        const calls = logSpy.mock.calls.map((call) => String((call as unknown[])[0] ?? ""))
        expect(calls.length).toBeGreaterThanOrEqual(2)

        const summary = JSON.parse(calls[0]) as {
          sessionID: string
          counts: { episodes: number; dispatches: number }
        }
        expect(summary.sessionID).toBe(session.id)
        expect(summary.counts.episodes).toBeGreaterThanOrEqual(1)
        expect(summary.counts.dispatches).toBeGreaterThanOrEqual(1)

        const full = JSON.parse(calls[1]) as {
          sessionID: string
          episodes: Array<{ summary: string }>
          dispatches: Array<{ action: string }>
        }
        expect(full.sessionID).toBe(session.id)
        expect(full.episodes.some((episode) => episode.summary === "episode-e2e")).toBe(true)
        expect(full.dispatches.some((item) => item.action === "dispatch-thread-e2e")).toBe(true)

        const app = Server.Default()
        const res = await app.request(`/session/${session.id}/weave`)
        expect(res.status).toBe(200)
        const api = (await res.json()) as { episodes: unknown[]; dispatches: unknown[] }
        expect(api.episodes.length).toBeGreaterThanOrEqual(1)
        expect(api.dispatches.length).toBeGreaterThanOrEqual(1)

        await Session.remove(session.id)
      },
    })
  })
})
