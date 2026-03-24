import { expect, test } from "bun:test"

import { createOpencodeClient } from "./opencode-sdk.browser"

test("browser opencode client sends prompt requests to the message endpoint", async () => {
  const calls: Array<{
    url: string
    method?: string
    headers?: HeadersInit
    body?: BodyInit | null
  }> = []

  const client = createOpencodeClient({
    baseUrl: "http://localhost:3000",
    fetch: async (input, init) => {
      calls.push({
        url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
      })

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })
    },
  })

  await client.session.prompt({
    sessionID: "session_123",
    parts: [{ id: "part_123", type: "text", text: "hello" }],
  })

  expect(calls).toHaveLength(1)
  expect(calls[0]?.method).toBe("POST")
  expect(calls[0]?.url).toBe("http://localhost:3000/session/session_123/message")
})
