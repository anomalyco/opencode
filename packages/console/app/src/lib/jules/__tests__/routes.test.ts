import { describe, expect, test, mock, afterEach } from "bun:test"
import * as routes from "../routes/jules"

const original = globalThis.fetch

function mockUpstream(status: number, body: unknown): void {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ) as unknown as typeof fetch
}

function mockUpstreamEmpty(status: number): void {
  globalThis.fetch = mock(() => Promise.resolve(new Response("", { status }))) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

const KEY = "test-api-key"

function req(method: string, body?: unknown, key?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (key !== undefined) headers["x-goog-api-key"] = key
  return new Request("http://localhost/v1/jules/test", {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe("auth", () => {
  test("rejects request without API key", async () => {
    const res = await routes.sources(req("GET"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain("x-goog-api-key")
  })
})

describe("sessions (create)", () => {
  test("proxies create session", async () => {
    const session = {
      name: "sessions/1",
      id: "1",
      prompt: "fix",
      state: "QUEUED",
      createTime: "2024-01-15T10:30:00Z",
      updateTime: "2024-01-15T10:30:00Z",
    }
    mockUpstream(200, session)
    const res = await routes.sessions(req("POST", { prompt: "fix" }, KEY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe("1")
  })

  test("returns 400 on invalid body", async () => {
    const res = await routes.sessions(req("POST", {}, KEY))
    expect(res.status).toBe(400)
  })
})

describe("session (get)", () => {
  test("proxies get session", async () => {
    const data = {
      name: "sessions/abc",
      id: "abc",
      prompt: "task",
      state: "COMPLETED",
      createTime: "2024-01-15T10:30:00Z",
      updateTime: "2024-01-15T11:00:00Z",
    }
    mockUpstream(200, data)
    const res = await routes.session(req("GET", undefined, KEY), "abc")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.state).toBe("COMPLETED")
  })

  test("returns 404 for missing session", async () => {
    mockUpstream(404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } })
    const res = await routes.session(req("GET", undefined, KEY), "missing")
    expect(res.status).toBe(404)
  })
})

describe("activities", () => {
  test("proxies list activities", async () => {
    mockUpstream(200, {
      activities: [
        {
          name: "sessions/1/activities/a1",
          id: "a1",
          originator: "system",
          description: "Started",
          createTime: "2024-01-15T10:30:00Z",
        },
      ],
    })
    const res = await routes.activities(req("GET", undefined, KEY), "1")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.activities.length).toBe(1)
  })
})

describe("approve", () => {
  test("proxies approve plan", async () => {
    mockUpstreamEmpty(200)
    const res = await routes.approve(req("POST", {}, KEY), "1")
    expect(res.status).toBe(200)
  })
})

describe("reject", () => {
  test("proxies reject plan", async () => {
    mockUpstreamEmpty(200)
    const res = await routes.reject(req("POST", { feedback: "needs more tests" }, KEY), "1")
    expect(res.status).toBe(200)
  })
})

describe("cancel", () => {
  test("proxies cancel session", async () => {
    mockUpstreamEmpty(200)
    const res = await routes.cancel(req("POST", {}, KEY), "1")
    expect(res.status).toBe(200)
  })
})

describe("sources", () => {
  test("proxies list sources", async () => {
    mockUpstream(200, {
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
    })
    const res = await routes.sources(req("GET", undefined, KEY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sources.length).toBe(1)
  })

  test("returns 429 on rate limit", async () => {
    mockUpstream(429, { error: { code: 429, message: "Rate limited", status: "RESOURCE_EXHAUSTED" } })
    const res = await routes.sources(req("GET", undefined, KEY))
    expect(res.status).toBe(429)
  })
})
