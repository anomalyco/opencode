import { describe, expect, test } from "bun:test"
import { archiveHomeSession } from "../home-session-archive"
import { sessionRemovalIDs } from "@/utils/session-delete"
import { publishSession, unpublishSession } from "@/utils/session-share"

describe("session actions", () => {
  test("publish returns share URL", async () => {
    expect(
      await publishSession(
        {
          session: {
            share: async () => ({ data: { share: { url: "https://share.example/session" } } }),
            unshare: async () => undefined,
          },
        },
        "ses_1",
      ),
    ).toBe("https://share.example/session")
  })

  test("publish rejects missing URL", async () => {
    expect(
      publishSession(
        { session: { share: async () => ({ data: {} }), unshare: async () => undefined } },
        "ses_1",
      ),
    ).rejects.toThrow("Session share URL missing")
  })

  test("unpublish calls client", async () => {
    const calls: string[] = []
    await unpublishSession(
      {
        session: {
          share: async () => ({ data: {} }),
          unshare: async ({ sessionID }) => calls.push(sessionID),
        },
      },
      "ses_1",
    )
    expect(calls).toEqual(["ses_1"])
  })

  test("deletion includes descendants only", () => {
    expect(
      [...sessionRemovalIDs([{ id: "root" }, { id: "child", parentID: "root" }, { id: "grand", parentID: "child" }, { id: "other" }], "root")],
    ).toEqual(["root", "child", "grand"])
  })
})

describe("archiveHomeSession", () => {
  test("removes session and tabs after archive", async () => {
    let removed = false
    await archiveHomeSession({
      server: "remote" as never,
      session: { id: "ses_1", directory: "/workspace" },
      archive: async () => undefined,
      remove: () => {
        removed = true
      },
    })
    expect(removed).toBe(true)
  })

  test("does not remove session after archive failure", async () => {
    let removed = false
    let cause: unknown
    const failure = new Error("offline")
    await archiveHomeSession({
      server: "remote" as never,
      session: { id: "ses_1", directory: "/workspace" },
      archive: async () => Promise.reject(failure),
      remove: () => {
        removed = true
      },
      onError: (error) => {
        cause = error
      },
    })
    expect(removed).toBe(false)
    expect(cause).toBe(failure)
  })
})
