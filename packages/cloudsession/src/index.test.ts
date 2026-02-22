import { describe, expect, test } from "bun:test"
import app from "./index.tsx"
import type { AgentSession, SyncInfo, SessionIndex } from "./types"
import {
  createTestFileDiff,
  createTestMessage,
  createTestModel,
  createTestPart,
  createTestSession,
  SESSION_PROPERTIES,
  validateTypeStructure,
} from "./test-utils"

const sharedSecret = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

const createMockR2Bucket = () => {
  const storage = new Map<string, string>()

  const mockBucket: any = {
    put: async (key: string, value: string | ArrayBuffer) => {
      let content = ""
      if (typeof value === "string") {
        content = value
      }
      if (value instanceof ArrayBuffer) {
        content = new TextDecoder().decode(value)
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
      }
    },
    delete: async (key: string) => {
      storage.delete(key)
    },
    list: async (options?: any) => {
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
  }

  return mockBucket
}

const createEnv = () => ({
  SESSIONS_STORE: createMockR2Bucket(),
  SESSIONS_SHARED_SECRET: sharedSecret,
  API_DOMAIN: "test.opencode.ai",
  SESSIONS_BROADCAST: {
    idFromName: () => ({ toString: () => "mock-id" }),
    get: () => ({
      broadcast: async () => {},
      fetch: async () => new Response(null, { status: 101 }),
    }),
  } as unknown as DurableObjectNamespace,
})

const parseJson = async <T>(response: Response) => (await response.json()) as T

const request = async (input: string, init: RequestInit, env: ReturnType<typeof createEnv>) => {
  return app.fetch(new Request(input, init), env)
}

const createShare = async (sessionID: string, env: ReturnType<typeof createEnv>) => {
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

const syncShare = async (
  shareID: string,
  env: ReturnType<typeof createEnv>,
  payload: { secret: string; data: Array<{ type: string; data: unknown }> },
) => {
  const response = await request(
    `http://localhost/api/share/${shareID}/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    env,
  )

  return { response, data: await parseJson<Record<string, unknown>>(response) }
}

describe("Sessions API", () => {
  test("client creates a share and syncs session data", async () => {
    const env = createEnv()
    const sessionID = "session-share-123"

    // Client creates a share via /api/share.
    const { response, data: share } = await createShare(sessionID, env)

    expect(response.status).toBe(200)
    validateTypeStructure(share, "SyncInfo", ["id", "url", "secret"])
    expect(share.url).toContain(`/share/${share.id}`)

    // Client syncs the same shapes queued by ShareNext.
    const session = createTestSession({ id: sessionID })
    const message = createTestMessage({ id: "msg-1", sessionID })
    const part = createTestPart({ id: "part-1", sessionID, messageID: "msg-1" })
    const diff = createTestFileDiff({ file: "test.ts" })
    const model = createTestModel({ id: "model-1", providerID: "test-provider" })

    const { response: syncResponse, data: syncResult } = await syncShare(share.id, env, {
      secret: share.secret,
      data: [
        { type: "session", data: session },
        { type: "message", data: message },
        { type: "part", data: part },
        { type: "session_diff", data: [diff] },
        { type: "model", data: [model] },
      ],
    })

    expect(syncResponse.status).toBe(200)
    expect(syncResult.success).toBe(true)
    expect(syncResult.syncCount).toBe(1)

    // Retrieve from GET /api/share/:id.
    const shareResponse = await request(`http://localhost/api/share/${share.id}`, { method: "GET" }, env)
    expect(shareResponse.status).toBe(200)

    const shareSession = await parseJson<AgentSession>(shareResponse)
    validateTypeStructure(shareSession.session, "Session", SESSION_PROPERTIES)
    expect(shareSession.messages).toHaveLength(1)
    expect(shareSession.parts).toHaveLength(1)
    expect(shareSession.diffs).toHaveLength(1)
    expect(shareSession.models).toHaveLength(1)
    expect(shareSession.metadata.syncCount).toBe(1)
  })

  test("client lists sessions after sync", async () => {
    const env = createEnv()
    const { data: share } = await createShare("session-a", env)

    await syncShare(share.id, env, {
      secret: share.secret,
      data: [{ type: "session", data: createTestSession({ id: "session-a" }) }],
    })

    const { data: shareB } = await createShare("session-b", env)

    await syncShare(shareB.id, env, {
      secret: shareB.secret,
      data: [{ type: "session", data: createTestSession({ id: "session-b" }) }],
    })

    const response = await request("http://localhost/api/sessions", { method: "GET" }, env)
    expect(response.status).toBe(200)

    const result = await parseJson<{ sessions: SessionIndex[]; count: number }>(response)
    expect(result.count).toBe(2)
    const ids = result.sessions.map((entry) => entry.sessionID)
    expect(ids).toContain("session-a")
    expect(ids).toContain("session-b")
  })
})
