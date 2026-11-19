import { describe, expect, test } from "bun:test"
import { startSession } from "./wire-fixture"

/** Regression test for #64686: ACP session methods must not hang while the
 * SSE event stream is open. On Windows, Bun's fetch (FetchHttpClient) is
 * starved by the long-lived /api/event connection, so session/new and
 * session/list never resolve. NodeHttpClient (node:http) is unaffected.
 */
describe("acp transport", () => {
  test("session/list completes while the SSE event stream is open", async () => {
    await using acp = await startSession()

    // The event stream is open from startWire. session/list must still resolve.
    const result = await acp.request("session/list", {})
    expect(result.sessions).toBeDefined()
    expect(Array.isArray(result.sessions)).toBe(true)
  })

  test("session/new completes while the SSE event stream is open", async () => {
    await using acp = await startSession()

    const session = await acp.newSession()
    expect(session.sessionId).toMatch(/^ses_\d+$/)
  })
})
