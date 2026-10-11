import { SessionID } from "@opencode/schema/session-id"
import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { requireServerKey, rootSession, sessionHref } from "./session"

describe("session routes", () => {
  test("builds and decodes a server-keyed session route", () => {
    const server = ServerConnection.Key.make("https://example.com:4096")
    const href = sessionHref(server, SessionID.make("session-1", { disableChecks: true }))

    expect(href).toBe("/server/aHR0cHM6Ly9leGFtcGxlLmNvbTo0MDk2/session/session-1")
    expect(requireServerKey(href.split("/")[2])).toBe(server)
  })

  test("rejects malformed server keys", () => {
    expect(() => requireServerKey("not-base64")).toThrow("Invalid server route")
  })

  test("resolves the root session", async () => {
    const sessions: Record<string, { id: SessionID; parentID?: SessionID }> = {
      child: {
        id: SessionID.make("child", { disableChecks: true }),
        parentID: SessionID.make("parent", { disableChecks: true }),
      },
      parent: {
        id: SessionID.make("parent", { disableChecks: true }),
        parentID: SessionID.make("root", { disableChecks: true }),
      },
      root: { id: SessionID.make("root", { disableChecks: true }) },
    }

    expect(
      await rootSession(sessions.child, async (id) => {
        const session = sessions[id]

        if (!session) throw new Error(`Missing session: ${id}`)

        return session
      }),
    ).toBe(sessions.root)
  })

  test("rejects a parent cycle", async () => {
    const sessions: Record<string, { id: SessionID; parentID?: SessionID }> = {
      child: {
        id: SessionID.make("child", { disableChecks: true }),
        parentID: SessionID.make("parent", { disableChecks: true }),
      },
      parent: {
        id: SessionID.make("parent", { disableChecks: true }),
        parentID: SessionID.make("child", { disableChecks: true }),
      },
    }

    await expect(rootSession(sessions.child, async (id) => sessions[id]!)).rejects.toThrow(
      "Session parent cycle: child",
    )
  })
})
