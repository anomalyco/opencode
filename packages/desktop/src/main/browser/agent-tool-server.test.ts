import { afterEach, describe, expect, test } from "bun:test"

import { startIntegratedBrowserAgentToolServer } from "./agent-tool-server"

const originalBridgeUrl = process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL
const originalBridgeToken = process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN

afterEach(() => {
  process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL = originalBridgeUrl
  process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN = originalBridgeToken
})

describe("integrated browser agent tool server", () => {
  test("binds to localhost, exports bridge env, and delegates tool execution to integrated BrowserManager handlers", async () => {
    const calls: Array<{ url: string; browserId?: string }> = []
    const server = await startIntegratedBrowserAgentToolServer({
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate using the OpenCode integrated browser.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          async handler(input) {
            calls.push({ url: String(input.url), browserId: typeof input.browserId === "string" ? input.browserId : undefined })
            return { ok: true, browserId: input.browserId }
          },
        },
      ],
      token: "secret-token",
    })

    try {
      expect(server.url).toStartWith("http://127.0.0.1:")
      expect(process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_URL).toBe(server.url)
      expect(process.env.OPENCODE_INTEGRATED_BROWSER_TOOL_TOKEN).toBe("secret-token")

      const res = await fetch(new URL("/tool", server.url), {
        method: "POST",
        headers: { authorization: "Bearer secret-token", "content-type": "application/json" },
        body: JSON.stringify({ tool: "browser_navigate", input: { url: "https://opencode.ai", browserId: "browser-1" } }),
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, result: { ok: true, browserId: "browser-1" } })
      expect(calls).toEqual([{ url: "https://opencode.ai", browserId: "browser-1" }])
    } finally {
      await server.stop()
    }
  })

  test("rejects unauthorized and unknown integrated browser tool requests", async () => {
    const server = await startIntegratedBrowserAgentToolServer({ tools: [], token: "secret-token" })

    try {
      expect(
        await fetch(new URL("/tool", server.url), {
          method: "POST",
          headers: { authorization: "Bearer wrong" },
          body: JSON.stringify({ tool: "browser_navigate", input: {} }),
        }),
      ).toHaveProperty("status", 401)

      expect(
        await fetch(new URL("/tool", server.url), {
          method: "POST",
          headers: { authorization: "Bearer secret-token" },
          body: JSON.stringify({ tool: "browser_navigate", input: {} }),
        }),
      ).toHaveProperty("status", 404)
    } finally {
      await server.stop()
    }
  })
})
