import { describe, expect, test } from "bun:test"
import { terminalConnectToken } from "./terminal-connect-token"

describe("terminalConnectToken", () => {
  test("requests a native V2 ticket scoped to the PTY location", async () => {
    const calls: { url: URL; init?: RequestInit }[] = []
    const result = await terminalConnectToken({
      url: "https://example.test",
      id: "pty_1",
      directory: "/repo/worktree",
      fetch: async (url, init) => {
        calls.push({ url: new URL(url instanceof Request ? url.url : url), init })
        return Response.json({ data: { ticket: "ticket-1", expires_in: 30 } })
      },
    })

    expect(result).toEqual({ status: 200, ticket: "ticket-1" })
    expect(calls[0]?.url.toString()).toBe(
      "https://example.test/api/pty/pty_1/connect-token?location%5Bdirectory%5D=%2Frepo%2Fworktree",
    )
    expect(calls[0]?.init).toEqual({ method: "POST", headers: { "x-opencode-ticket": "1" } })
  })

  test("returns the response status when the ticket request fails", async () => {
    const result = await terminalConnectToken({
      url: "https://example.test",
      id: "pty_1",
      directory: "/repo",
      fetch: async () => new Response(null, { status: 403 }),
    })

    expect(result).toEqual({ status: 403 })
  })
})
