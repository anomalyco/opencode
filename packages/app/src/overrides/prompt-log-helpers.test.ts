import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { trackPrompt } from "./prompt-log-helpers"

describe("trackPrompt", () => {
  let originalFetch: typeof globalThis.fetch
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    fetchMock = mock(() => Promise.resolve(new Response(null, { status: 204 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("sends POST to /api/prompt-logs with correct body", () => {
    trackPrompt({
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

  test("sends only promptText when optional fields are omitted", () => {
    trackPrompt({ promptText: "Hello" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.promptText).toBe("Hello")
    expect(body.sessionId).toBeUndefined()
    expect(body.projectName).toBeUndefined()
    expect(body.modelId).toBeUndefined()
    expect(body.agentName).toBeUndefined()
  })

  test("does not throw when fetch rejects", () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network error"))) as unknown as typeof fetch

    expect(() => {
      trackPrompt({ promptText: "test" })
    }).not.toThrow()
  })

  test("is fire-and-forget (returns void synchronously)", () => {
    const result = trackPrompt({ promptText: "test" })
    expect(result).toBeUndefined()
  })
})
