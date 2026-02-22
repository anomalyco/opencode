import { describe, expect, test, beforeEach } from "bun:test"
import app from "./index.tsx"
import type { AgentSession, SyncInfo, SessionIndex } from "./types"
import { createTestFileDiff, createTestMessage, createTestModel, createTestPart, createTestSession } from "./test-utils"

const SHARED_SECRET = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

type TestEnv = {
  SESSIONS_STORE: R2Bucket
  SESSIONS_SHARED_SECRET: string
  API_DOMAIN: string
  SESSIONS_BROADCAST: DurableObjectNamespace
}

function createMockR2Bucket() {
  const storage = new Map<string, string>()

  return {
    put: async (key: string, value: string | ArrayBuffer | ReadableStream) => {
      let content = ""
      if (typeof value === "string") {
        content = value
      } else if (value instanceof ArrayBuffer) {
        content = new TextDecoder().decode(value)
      } else if (value instanceof ReadableStream) {
        const reader = value.getReader()
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value: chunk } = await reader.read()
          if (done) break
          chunks.push(chunk)
        }
        content = new TextDecoder().decode(Buffer.concat(chunks))
      }
      storage.set(key, content)
    },
    get: async (key: string) => {
      const data = storage.get(key)
      if (!data) return null
      return {
        async text() {
          return data
        },
        async arrayBuffer() {
          return new TextEncoder().encode(data).buffer
        },
        async json() {
          return JSON.parse(data)
        },
      }
    },
    delete: async (key: string) => {
      storage.delete(key)
    },
    list: async (options?: { prefix?: string }) => {
      const prefix = options?.prefix || ""
      const objects = Array.from(storage.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({
          key,
          version: "mock",
          size: storage.get(key)!.length,
          etag: `"mock-${key}"`,
          httpMetadata: { contentType: "application/json" },
          customMetadata: {},
          uploaded: new Date(),
        }))
      return { objects }
    },
  } as unknown as R2Bucket
}

function createMockDONamespace() {
  return {
    idFromName: () => ({ toString: () => "mock-id" }),
    get: () => ({
      broadcast: async () => {},
      fetch: async () => new Response(null, { status: 101 }),
    }),
  } as unknown as DurableObjectNamespace
}

function createEnv(): TestEnv {
  return {
    SESSIONS_STORE: createMockR2Bucket(),
    SESSIONS_SHARED_SECRET: SHARED_SECRET,
    API_DOMAIN: "opencode.api.com",
    SESSIONS_BROADCAST: createMockDONamespace(),
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function request(input: string, init: RequestInit, env: TestEnv) {
  return app.fetch(new Request(input, init), env)
}

async function createShare(sessionID: string, env: TestEnv) {
  const response = await request(
    "http://localhost/api/share",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionID }),
    },
    env,
  )
  return { response, data: await parseJson<SyncInfo>(response) }
}

async function syncShare(
  shareID: string,
  env: TestEnv,
  payload: { secret: string; data: Array<{ type: string; data: unknown }> },
) {
  const response = await request(
    `http://localhost/api/share/${shareID}/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    env,
  )
  return { response, data: await parseJson<{ success: boolean; syncCount: number; error?: string }>(response) }
}

async function deleteShare(shareID: string, env: TestEnv, secret: string) {
  const response = await request(
    `http://localhost/api/share/${shareID}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    },
    env,
  )
  return { response, data: await parseJson<{ success?: boolean; error?: string }>(response) }
}

async function getShare(shareID: string, env: TestEnv) {
  const response = await request(`http://localhost/api/share/${shareID}`, { method: "GET" }, env)
  if (!response.ok) {
    return { response, data: null }
  }
  return { response, data: await parseJson<AgentSession>(response) }
}

async function getMetadata(shareID: string, env: TestEnv) {
  const response = await request(`http://localhost/api/share/${shareID}/metadata`, { method: "GET" }, env)
  if (!response.ok) {
    return { response, data: null }
  }
  return { response, data: await parseJson<SessionIndex>(response) }
}

async function listSessions(env: TestEnv) {
  const response = await request("http://localhost/api/sessions", { method: "GET" }, env)
  return {
    response,
    data: await parseJson<{ sessions: SessionIndex[]; count: number }>(response),
  }
}

describe("POST /api/share", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createEnv()
  })

  test("creates share with valid sessionID", async () => {
    const { response, data } = await createShare("session-abc123", env)
    expect(response.status).toBe(200)
    expect(data.id).toBe("n-abc123")
    expect(data.secret).toBeDefined()
    expect(data.url).toBe(`https://opencode.api.com/share/n-abc123`)
  })

  test("returns {id, url, secret} with correct types", async () => {
    const { data } = await createShare("test-session-id", env)
    expect(typeof data.id).toBe("string")
    expect(typeof data.url).toBe("string")
    expect(typeof data.secret).toBe("string")
  })

  test("generates share ID as last 8 chars of sessionID", async () => {
    const { data } = await createShare("1234567890abcdefghijklmnop", env)
    expect(data.id).toBe("ijklmnop")
  })

  test("secret is deterministic (same sessionID = same secret)", async () => {
    const env1 = createEnv()
    const env2 = createEnv()
    const { data: share1 } = await createShare("same-session-id", env1)
    const { data: share2 } = await createShare("same-session-id", env2)
    expect(share1.secret).toBe(share2.secret)
  })
})

describe("POST /api/share/:id/sync", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createEnv()
  })

  test("accepts valid sync and returns {success, syncCount}", async () => {
    const { data: share } = await createShare("sync-test", env)
    const session = createTestSession({ id: "sync-test" })

    const { response, data } = await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session", data: session }],
    })

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.syncCount).toBe(1)
  })

  test("rejects invalid secret with 403", async () => {
    const { data: share } = await createShare("sync-test", env)
    const session = createTestSession({ id: "sync-test" })

    const { response, data } = await syncShare(share.id, env, {
      secret: "wrong-secret",
      data: [{ type: "session", data: session }],
    })

    expect(response.status).toBe(403)
    expect(data.error).toBe("Invalid secret")
  })

  test("returns 404 for non-existent share", async () => {
    const { response, data } = await syncShare("nonexist", env, {
      secret: "any-secret",
      data: [{ type: "session", data: createTestSession() }],
    })

    expect(response.status).toBe(404)
    expect(data.error).toBe("Share not found")
  })

  test("appends new messages", async () => {
    const { data: share } = await createShare("msg-test", env)
    const msg1 = createTestMessage({ id: "msg-1", sessionID: "msg-test" })
    const msg2 = createTestMessage({ id: "msg-2", sessionID: "msg-test" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "message", data: msg1 }],
    })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "message", data: msg2 }],
    })

    const { data: session } = await getShare(share.id, env)
    if (!session) throw new Error("Expected session")
    expect(session.messages).toHaveLength(2)
    const first = session.messages[0]
    const second = session.messages[1]
    if (!first || !second) throw new Error("Expected messages")
    expect(first.id).toBe("msg-1")
    expect(second.id).toBe("msg-2")
  })

  test("updates existing message with same ID", async () => {
    const { data: share } = await createShare("msg-update", env)
    const msg = createTestMessage({ id: "msg-1", sessionID: "msg-update", role: "user" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "message", data: msg }],
    })

    const updatedMsg = { ...msg, role: "assistant" }
    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "message", data: updatedMsg }],
    })

    const { data: session } = await getShare(share.id, env)
    if (!session) throw new Error("Expected session")
    expect(session.messages).toHaveLength(1)
    const first = session.messages[0]
    if (!first) throw new Error("Expected message")
    expect(first.role).toBe("assistant")
  })

  test("appends new parts", async () => {
    const { data: share } = await createShare("part-test", env)
    const part1 = createTestPart({ id: "part-1", sessionID: "part-test", messageID: "msg-1" })
    const part2 = createTestPart({ id: "part-2", sessionID: "part-test", messageID: "msg-1" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "part", data: part1 }],
    })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "part", data: part2 }],
    })

    const { data: session } = await getShare(share.id, env)
    if (!session) throw new Error("Expected session")
    expect(session.parts).toHaveLength(2)
  })

  test("updates existing part with same ID", async () => {
    const { data: share } = await createShare("part-update", env)
    const original = createTestPart({ id: "part-1", sessionID: "part-update", messageID: "msg-1", text: "original" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "part", data: original }],
    })

    const updatedPart = { ...original, text: "updated" }
    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "part", data: updatedPart }],
    })

    const { data: session } = await getShare(share.id, env)
    if (!session) throw new Error("Expected session")
    expect(session.parts).toHaveLength(1)
    const first = session.parts[0]
    if (!first) throw new Error("Expected part")
    if (first.type !== "text") throw new Error("Expected text part")
    expect(first.text).toBe("updated")
  })

  test("accumulates diffs (appends, never dedupes)", async () => {
    const { data: share } = await createShare("diff-test", env)
    const diff1 = createTestFileDiff({ file: "file1.ts" })
    const diff2 = createTestFileDiff({ file: "file2.ts" })
    const diff3 = createTestFileDiff({ file: "file1.ts" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session_diff", data: [diff1, diff2] }],
    })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session_diff", data: [diff3] }],
    })

    const { data: session } = await getShare(share.id, env)
    if (!session) throw new Error("Expected session")
    expect(session.diffs).toHaveLength(3)
  })

  test("adds new models", async () => {
    const { data: share } = await createShare("model-test", env)
    const model1 = createTestModel({ id: "gpt-4", providerID: "openai" })
    const model2 = createTestModel({ id: "claude", providerID: "anthropic" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "model", data: [model1, model2] }],
    })

    const { data: session } = await getShare(share.id, env)
    if (!session) throw new Error("Expected session")
    expect(session.models).toHaveLength(2)
  })

  test("updates existing model with same ID", async () => {
    const { data: share } = await createShare("model-update", env)
    const model = createTestModel({ id: "gpt-4", providerID: "openai", name: "GPT-4" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "model", data: [model] }],
    })

    const updatedModel = { ...model, name: "GPT-4 Turbo" }
    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "model", data: [updatedModel] }],
    })

    const { data: session } = await getShare(share.id, env)
    if (!session) throw new Error("Expected session")
    expect(session.models).toHaveLength(1)
    const first = session.models[0]
    if (!first) throw new Error("Expected model")
    expect(first.name).toBe("GPT-4 Turbo")
  })

  test("increments syncCount on each sync", async () => {
    const { data: share } = await createShare("count-test", env)

    const r1 = await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session", data: createTestSession() }],
    })
    expect(r1.data.syncCount).toBe(1)

    const r2 = await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session", data: createTestSession() }],
    })
    expect(r2.data.syncCount).toBe(2)

    const r3 = await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session", data: createTestSession() }],
    })
    expect(r3.data.syncCount).toBe(3)
  })

  test("updates lastUpdated timestamp", async () => {
    const { data: share } = await createShare("timestamp-test", env)

    await syncShare(share.id, env, { secret: share.secret, data: [{ type: "session", data: createTestSession() }] })
    const { data: session1 } = await getShare(share.id, env)
    if (!session1) throw new Error("Expected session")
    const ts1 = session1.metadata.lastUpdated

    await new Promise((r) => setTimeout(r, 10))

    await syncShare(share.id, env, { secret: share.secret, data: [{ type: "session", data: createTestSession() }] })
    const { data: session2 } = await getShare(share.id, env)
    if (!session2) throw new Error("Expected session")
    const ts2 = session2.metadata.lastUpdated

    expect(ts2).toBeGreaterThan(ts1)
  })
})

describe("DELETE /api/share/:id", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createEnv()
  })

  test("deletes share with valid secret", async () => {
    const { data: share } = await createShare("delete-test", env)
    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session", data: createTestSession({ id: "delete-test" }) }],
    })

    const { response, data } = await deleteShare(share.id, env, share.secret)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  test("rejects invalid secret with 403", async () => {
    const { data: share } = await createShare("delete-auth-test", env)

    const { response, data } = await deleteShare(share.id, env, "wrong-secret")

    expect(response.status).toBe(403)
    expect(data.error).toBe("Invalid secret")
  })

  test("returns 404 for non-existent share", async () => {
    const { response, data } = await deleteShare("nonexist", env, "any-secret")

    expect(response.status).toBe(404)
    expect(data.error).toBe("Share not found")
  })

  test("removes from storage (subsequent GET returns 404)", async () => {
    const { data: share } = await createShare("delete-verify", env)
    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session", data: createTestSession({ id: "delete-verify" }) }],
    })

    await deleteShare(share.id, env, share.secret)

    const { response } = await getShare(share.id, env)
    expect(response.status).toBe(404)
  })
})

describe("GET /api/share/:id", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createEnv()
  })

  test("returns AgentSession with all fields", async () => {
    const { data: share } = await createShare("get-test", env)
    const session = createTestSession({ id: "get-test", title: "Test Session" })
    const msg = createTestMessage({ id: "msg-1", sessionID: "get-test" })
    const part = createTestPart({ id: "part-1", sessionID: "get-test", messageID: "msg-1" })
    const diff = createTestFileDiff({ file: "test.ts" })
    const model = createTestModel({ id: "gpt-4" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [
        { type: "session", data: session },
        { type: "message", data: msg },
        { type: "part", data: part },
        { type: "session_diff", data: [diff] },
        { type: "model", data: [model] },
      ],
    })

    const { response, data } = await getShare(share.id, env)

    expect(response.status).toBe(200)
    if (!data) throw new Error("Expected session")
    expect(data.session.id).toBe("get-test")
    expect(data.session.title).toBe("Test Session")
    expect(data.messages).toHaveLength(1)
    expect(data.parts).toHaveLength(1)
    expect(data.diffs).toHaveLength(1)
    expect(data.models).toHaveLength(1)
    expect(data.metadata.syncCount).toBe(1)
  })

  test("returns 404 for non-existent share", async () => {
    const { response } = await getShare("nonexist", env)
    expect(response.status).toBe(404)
  })
})

describe("GET /api/sessions", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createEnv()
  })

  test("returns empty array when no shares", async () => {
    const { data } = await listSessions(env)
    expect(data.sessions).toEqual([])
    expect(data.count).toBe(0)
  })

  test("returns all shares with count", async () => {
    const { data: share1 } = await createShare("session-list-a", env)
    await syncShare(share1.id, env, {
      secret: share1.secret,
      data: [{ type: "session", data: createTestSession({ id: "session-list-a" }) }],
    })

    const { data: share2 } = await createShare("session-list-b", env)
    await syncShare(share2.id, env, {
      secret: share2.secret,
      data: [{ type: "session", data: createTestSession({ id: "session-list-b" }) }],
    })

    const { data } = await listSessions(env)

    expect(data.count).toBe(2)
    const ids = data.sessions.map((s) => s.sessionID)
    expect(ids).toContain("session-list-a")
    expect(ids).toContain("session-list-b")
  })

  test("includes sessionID and createdAt for each", async () => {
    const { data: share } = await createShare("session-fields", env)
    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session", data: createTestSession({ id: "session-fields" }) }],
    })

    const { data } = await listSessions(env)

    const first = data.sessions[0]
    if (!first) throw new Error("Expected session list entry")
    expect(first.sessionID).toBe("session-fields")
    expect(typeof first.createdAt).toBe("number")
  })
})

describe("GET /api/share/:id/metadata", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createEnv()
  })

  test("returns summary without full data", async () => {
    const { data: share } = await createShare("meta-test", env)
    const session = createTestSession({ id: "meta-test", title: "Metadata Test" })
    const msg = createTestMessage({ id: "msg-1", sessionID: "meta-test" })
    const part = createTestPart({ id: "part-1", sessionID: "meta-test", messageID: "msg-1" })
    const diff = createTestFileDiff({ file: "test.ts" })
    const model = createTestModel({ id: "gpt-4" })

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [
        { type: "session", data: session },
        { type: "message", data: msg },
        { type: "part", data: part },
        { type: "session_diff", data: [diff] },
        { type: "model", data: [model] },
      ],
    })

    const { response, data } = await getMetadata(share.id, env)

    expect(response.status).toBe(200)
    if (!data) throw new Error("Expected metadata")
    expect(data.sessionID).toBe("meta-test")
    expect(data.title).toBe("Metadata Test")
    expect(data.messageCount).toBe(1)
    expect(data.partCount).toBe(1)
    expect(data.diffCount).toBe(1)
    expect(data.modelCount).toBe(1)
    expect(data.syncCount).toBe(1)
    expect(typeof data.lastUpdated).toBe("number")
  })

  test("returns 404 for non-existent share", async () => {
    const { response } = await getMetadata("nonexist", env)
    expect(response.status).toBe(404)
  })
})

describe("GET /", () => {
  test("redirects to /sessions", async () => {
    const env = createEnv()
    const response = await request("http://localhost/", { method: "GET" }, env)

    expect(response.status).toBe(302)
    expect(response.headers.get("Location")).toBe("/sessions")
  })
})
