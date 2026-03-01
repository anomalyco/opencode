import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import * as client from "../client/JulesClient"

// Mock fetch globally for client tests
const original = globalThis.fetch

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ) as unknown as typeof fetch
}

function mockFetchEmpty(status: number): void {
  globalThis.fetch = mock(() => Promise.resolve(new Response("", { status }))) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

describe("create", () => {
  test("returns session on success", async () => {
    const session = {
      name: "sessions/123",
      id: "123",
      prompt: "fix tests",
      state: "QUEUED",
      createTime: "2024-01-15T10:30:00Z",
      updateTime: "2024-01-15T10:30:00Z",
    }
    mockFetch(200, session)
    const result = await client.create("key", { prompt: "fix tests" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe("123")
  })

  test("returns validation error on empty prompt", async () => {
    const result = await client.create("key", { prompt: "" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.name).toBe("JulesValidationError")
  })

  test("returns error on 401", async () => {
    mockFetch(401, { error: { code: 401, message: "Unauthorized", status: "UNAUTHENTICATED" } })
    const result = await client.create("bad-key", { prompt: "fix tests" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.name).toBe("JulesAuthError")
  })

  test("returns error on 429", async () => {
    mockFetch(429, { error: { code: 429, message: "Rate limit", status: "RESOURCE_EXHAUSTED" } })
    const result = await client.create("key", { prompt: "fix tests" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.name).toBe("JulesRateLimitError")
  })
})

describe("get", () => {
  test("returns session on success", async () => {
    const session = {
      name: "sessions/456",
      id: "456",
      prompt: "add tests",
      state: "COMPLETED",
      createTime: "2024-01-15T10:30:00Z",
      updateTime: "2024-01-15T11:00:00Z",
    }
    mockFetch(200, session)
    const result = await client.get("key", "456")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.state).toBe("COMPLETED")
  })

  test("returns error on 404", async () => {
    mockFetch(404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } })
    const result = await client.get("key", "missing")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.name).toBe("JulesNotFoundError")
  })
})

describe("activities", () => {
  test("returns activities list", async () => {
    const response = {
      activities: [
        {
          name: "sessions/123/activities/act1",
          id: "act1",
          originator: "system",
          description: "Started",
          createTime: "2024-01-15T10:30:00Z",
        },
      ],
    }
    mockFetch(200, response)
    const result = await client.activities("key", "123")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.activities.length).toBe(1)
  })
})

describe("approve", () => {
  test("returns session on success", async () => {
    mockFetchEmpty(200)
    const result = await client.approve("key", "123")
    expect(result.ok).toBe(true)
  })
})

describe("reject", () => {
  test("returns session on success", async () => {
    mockFetchEmpty(200)
    const result = await client.reject("key", "123", "needs more tests")
    expect(result.ok).toBe(true)
  })
})

describe("cancel", () => {
  test("returns session on success", async () => {
    mockFetchEmpty(200)
    const result = await client.cancel("key", "123")
    expect(result.ok).toBe(true)
  })
})

describe("sources", () => {
  test("returns sources list", async () => {
    const response = {
      sources: [
        {
          name: "sources/github-org-repo",
          id: "github-org-repo",
          githubRepo: {
            owner: "org",
            repo: "repo",
            isPrivate: false,
            defaultBranch: { displayName: "main" },
            branches: [{ displayName: "main" }],
          },
        },
      ],
    }
    mockFetch(200, response)
    const result = await client.sources("key")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.sources.length).toBe(1)
  })
})
