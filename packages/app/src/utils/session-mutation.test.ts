import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ServerSync } from "@/context/server-sync"
import { applySession, createSessionMutation, removeSession, type SessionMutationSync } from "./session-mutation"

const session = { id: "ses_1", directory: "/project", title: "Old", time: { created: 1, updated: 1 } } as Session

function fixture(input: { fail?: boolean; shareURL?: string } = {}) {
  const state = { session: [session] }
  const remembered: Session[] = []
  const evicted: string[] = []
  const events: Array<{ type: string; sessionID: string; title?: string }> = []
  const client = {
    session: {
      update: async () => {
        if (input.fail) throw new Error("failed")
      },
      delete: async () => {
        if (input.fail) throw new Error("failed")
      },
      share: async () => ({ data: input.shareURL ? { ...session, share: { url: input.shareURL } } : undefined }),
      unshare: async () => {
        if (input.fail) throw new Error("failed")
        return { data: { ...session, share: undefined } }
      },
    },
  }
  const serverSync: SessionMutationSync = {
    session: {
      remember(value: Session) {
        remembered.push(value)
        return value
      },
      evict(id: string) {
        evicted.push(id)
      },
    },
    peek() {
      return [
        state,
        (update: unknown) => {
          if (typeof update === "function") {
            (update as (draft: { session: Session[] }) => void)(state)
          }
        },
      ] as ReturnType<ServerSync["peek"]>
    },
    homeSessions: {
      apply(event) {
        events.push({ type: event.type, sessionID: event.properties.sessionID, title: event.properties.info?.title })
      },
    },
  }
  return { mutation: createSessionMutation({ client, serverSync }), serverSync, remembered, evicted, events, state }
}

describe("session mutation", () => {
  test("applySession and removeSession commit cache directly", () => {
    const result = fixture()
    applySession(result.serverSync, { ...session, title: "Applied" })
    expect(result.remembered[0]?.title).toBe("Applied")
    expect(result.state.session[0]?.title).toBe("Applied")
    expect(result.events).toEqual([{ type: "session.updated", sessionID: session.id, title: "Applied" }])

    removeSession(result.serverSync, session.id, session.directory, ["ses_child"])
    expect(result.evicted).toEqual(["ses_1", "ses_child"])
    expect(result.state.session).toEqual([])
    expect(result.events.slice(1)).toEqual([
      { type: "session.deleted", sessionID: "ses_1", title: undefined },
      { type: "session.deleted", sessionID: "ses_child", title: undefined },
    ])
  })

  test("writes rename only after API success", async () => {
    const result = fixture()
    await result.mutation.rename(session, "New")
    expect(result.remembered[0]?.title).toBe("New")
    expect(result.state.session[0]?.title).toBe("New")
    expect(result.events).toEqual([{ type: "session.updated", sessionID: session.id, title: "New" }])
  })

  test("does not write failed mutation", async () => {
    const result = fixture({ fail: true })
    await expect(result.mutation.rename(session, "New")).rejects.toThrow("failed")
    expect(result.remembered).toEqual([])
    expect(result.events).toEqual([])
  })

  test("removes descendants after delete", async () => {
    const result = fixture()
    result.state.session.push({ ...session, id: "ses_2", parentID: session.id })
    await result.mutation.delete(session)
    expect(result.evicted).toEqual(["ses_1", "ses_2"])
    expect(result.state.session).toEqual([])
    expect(result.events).toEqual([
      { type: "session.deleted", sessionID: "ses_1", title: undefined },
      { type: "session.deleted", sessionID: "ses_2", title: undefined },
    ])
  })

  test("archives, publishes, and unpublishes through shared commits", async () => {
    const result = fixture({ shareURL: "https://share" })
    await result.mutation.publish(session)
    await result.mutation.unpublish({ ...session, share: { url: "https://share" } })
    await result.mutation.archive(session)
    expect(result.events.map((event) => event.type)).toEqual([
      "session.updated",
      "session.updated",
      "session.created",
      "session.deleted",
    ])
    expect(result.events[0]?.title).toBe("Old")
    expect(result.state.session.map((item) => item.id)).toEqual(["ses_2"])
    expect(result.evicted).toEqual(["ses_1"])
  })
})
