import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { trackPrompt } from "./prompt-log-helpers"

describe("trackPrompt", () => {
  let originalFetch: typeof globalThis.fetch
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ promptId: "test-uuid-123" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("sends POST to /api/prompt-logs with correct body", async () => {
    await trackPrompt({
      promptText: "How do I deploy?",
      sessionId: "sess-123",
      projectName: "my-app",
      modelId: "claude-sonnet-4-6",
      agentName: "developer",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/prompt-logs")
    expect(options.method).toBe("POST")
    expect(options.credentials).toBe("include")
    expect(options.headers).toEqual({ "Content-Type": "application/json" })
    expect(JSON.parse(options.body)).toEqual({
      promptText: "How do I deploy?",
      sessionId: "sess-123",
      projectName: "my-app",
      modelId: "claude-sonnet-4-6",
      agentName: "developer",
    })
  })

  test("sends only promptText when optional fields are omitted", async () => {
    await trackPrompt({ promptText: "Hello" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.promptText).toBe("Hello")
    expect(body.sessionId).toBeUndefined()
    expect(body.projectName).toBeUndefined()
    expect(body.modelId).toBeUndefined()
    expect(body.agentName).toBeUndefined()
  })

  test("returns promptId from successful response", async () => {
    const result = await trackPrompt({ promptText: "test" })
    expect(result).toBe("test-uuid-123")
  })

  test("returns null when fetch rejects", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network error"))) as unknown as typeof fetch

    const result = await trackPrompt({ promptText: "test" })
    expect(result).toBeNull()
  })

  test("returns null when response is not ok", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 500 })),
    ) as unknown as typeof fetch

    const result = await trackPrompt({ promptText: "test" })
    expect(result).toBeNull()
  })
})
