import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import { legacySessionHref, requireServerKey, rootSession, sessionHref } from "./session-route"

describe("session routes", () => {
  test("builds and decodes a server-keyed session route", () => {
    const server = ServerConnection.Key.make("https://example.com:4096")
    const href = sessionHref(server, "session-1")

    expect(href).toBe("/server/aHR0cHM6Ly9leGFtcGxlLmNvbTo0MDk2/session/session-1")
    expect(requireServerKey(href.split("/")[2])).toBe(server)
  })

  test("rejects malformed server keys", () => {
    expect(() => requireServerKey("not-base64")).toThrow("Invalid server route")
  })

  test("builds the legacy directory-keyed route", () => {
    expect(legacySessionHref("/Users/example/project", "session-1")).toBe(
      "/L1VzZXJzL2V4YW1wbGUvcHJvamVjdA/session/session-1",
    )
  })

  test("resolves the root session", async () => {
    const sessions: Record<string, { id: string; parentID?: string }> = {
      child: { id: "child", parentID: "parent" },
      parent: { id: "parent", parentID: "root" },
      root: { id: "root" },
    }

    expect(
      await rootSession(sessions.child, async (id) => {
        const session = sessions[id]
        if (!session) throw new Error(`Missing session: ${id}`)
        return session
      }),
    ).toBe(sessions.root)
  })
})
