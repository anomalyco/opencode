import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Collaboration } from "./types"
import { CollaborationQueue } from "./queue"

const sessions = new Map<string, Collaboration.SessionState>()
const published: Array<{ type: string; properties: any }> = []

mock.module("./index", () => ({
  CollaborationSession: {
    getSession: (sessionID: string) => {
      if (!sessions.has(sessionID)) {
        sessions.set(sessionID, {
          sessionID,
          participants: {},
          messageQueue: [],
          typingStatuses: {},
          pendingWaits: [],
        } as any)
      }
      return sessions.get(sessionID)!
    },
    Event: {
      MessageQueued: { type: "collaboration.message.queued" },
      QueueFlushed: { type: "collaboration.queue.flushed" },
      QueueReady: { type: "collaboration.queue.ready" },
      WaitingFor: { type: "collaboration.waiting.for" },
      WaitResolved: { type: "collaboration.wait.resolved" },
    },
  },
}))

mock.module("@/bus", () => ({
  Bus: {
    publish: (def: { type: string }, properties: any) => {
      published.push({ type: def.type, properties })
    },
  },
}))

mock.module("@/util/log", () => ({
  Log: {
    create: () => ({
      info: () => {},
      error: () => {},
    }),
  },
}))

mock.module("@/id/id", () => ({
  Identifier: {
    ascending: (prefix: string) => `${prefix}_test`,
  },
}))

describe("CollaborationQueue", () => {
  beforeEach(() => {
    sessions.clear()
    published.length = 0
  })

  test("does not mark ready when no waits exist", () => {
    const sessionID = "ses_test"
    const session = sessions.get(sessionID) ?? (sessions.set(sessionID, {
      sessionID,
      participants: {
        clb_driver: { id: "clb_driver", sessionID, name: "driver", role: "driver", time: { joined: 0, lastSeen: 0 } },
        clb_alice: { id: "clb_alice", sessionID, name: "alice", role: "participant", time: { joined: 0, lastSeen: 0 } },
      } as any,
      messageQueue: [],
      typingStatuses: {},
      pendingWaits: [],
    } as any), sessions.get(sessionID)!)

    CollaborationQueue.enqueue({
      sessionID,
      participantID: "clb_alice",
      participantName: "alice",
      text: "hello",
      attachments: [],
    })

    const check = CollaborationQueue.shouldFlush(sessionID)
    expect(check.flush).toBe(false)
    expect(check.reason).toBe("no_pending_waits")
    expect(published.some((e) => e.type === "collaboration.queue.ready")).toBe(false)
    expect(session.messageQueue.length).toBe(1)
  })

  test("tracks pending waits and becomes ready when resolved (without auto-clearing)", () => {
    const sessionID = "ses_test"
    sessions.set(sessionID, {
      sessionID,
      participants: {
        clb_driver: { id: "clb_driver", sessionID, name: "driver", role: "driver", time: { joined: 0, lastSeen: 0 } },
        clb_alice: { id: "clb_alice", sessionID, name: "alice", role: "participant", time: { joined: 0, lastSeen: 0 } },
        clb_bob: { id: "clb_bob", sessionID, name: "bob", role: "participant", time: { joined: 0, lastSeen: 0 } },
      } as any,
      messageQueue: [],
      typingStatuses: {},
      pendingWaits: [],
    } as any)

    CollaborationQueue.enqueue({
      sessionID,
      participantID: "clb_bob",
      participantName: "bob",
      text: "what do you think? ~alice",
      attachments: [],
    })

    const pending = CollaborationQueue.shouldFlush(sessionID)
    expect(pending.flush).toBe(false)
    expect(pending.reason).toBe("pending_waits")
    expect(pending.waitingFor).toEqual(["alice"])

    // Alice responds -> waiting clears, queue becomes ready but is not flushed.
    CollaborationQueue.recordResponse(sessionID, "clb_alice")

    const waitingEvents = published.filter((e) => e.type === "collaboration.waiting.for")
    expect(waitingEvents.at(-1)?.properties.waitingFor).toEqual([])

    expect(published.some((e) => e.type === "collaboration.queue.ready")).toBe(true)
    expect(sessions.get(sessionID)!.messageQueue.length).toBe(1)

    const ready = CollaborationQueue.shouldFlush(sessionID)
    expect(ready.flush).toBe(true)
    expect(ready.reason).toBe("all_waits_resolved")
  })

  test("forceFlush clears the queue and pending waits (driver only)", () => {
    const sessionID = "ses_test"
    sessions.set(sessionID, {
      sessionID,
      participants: {
        clb_driver: { id: "clb_driver", sessionID, name: "driver", role: "driver", time: { joined: 0, lastSeen: 0 } },
        clb_alice: { id: "clb_alice", sessionID, name: "alice", role: "participant", time: { joined: 0, lastSeen: 0 } },
        clb_bob: { id: "clb_bob", sessionID, name: "bob", role: "participant", time: { joined: 0, lastSeen: 0 } },
      } as any,
      messageQueue: [],
      typingStatuses: {},
      pendingWaits: [],
    } as any)

    CollaborationQueue.enqueue({
      sessionID,
      participantID: "clb_bob",
      participantName: "bob",
      text: "ping ~alice",
      attachments: [],
    })

    expect(() => CollaborationQueue.forceFlush(sessionID, "clb_bob")).toThrow()

    const flushed = CollaborationQueue.forceFlush(sessionID, "clb_driver")
    expect(flushed).toBe(true)
    expect(sessions.get(sessionID)!.messageQueue.length).toBe(0)
    expect(sessions.get(sessionID)!.pendingWaits.length).toBe(0)
    expect(published.some((e) => e.type === "collaboration.queue.flushed")).toBe(true)
  })
})

