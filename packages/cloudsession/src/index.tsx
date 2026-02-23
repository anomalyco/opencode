import { Hono } from "hono"
import { cors } from "hono/cors"
import { newWorkersRpcResponse } from "capnweb"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { v5 as uuidv5 } from "uuid"
import type { SyncInfo, ShareCredentials, AgentSession, SessionIndex } from "./types.ts"
import { createStorageAdapter, type StorageAdapter } from "./storage.ts"
import SessionList from "./views/session-list.tsx"
import SessionDetail from "./views/session-detail.tsx"
import NotFound from "./views/not-found.tsx"
import { ShareRpcImpl } from "./rpc.ts"

import type { SessionBroadcast as SessionBroadcastType } from "./broadcast.ts"

// Re-export Durable Object class (required by wrangler)
export { SessionBroadcast } from "./broadcast.ts"

/**
 * Environment bindings for Cloudflare Worker
 */
type Env = {
  SESSIONS_STORE: R2Bucket
  SESSIONS_SHARED_SECRET: string
  SESSIONS_RPC_SHARED_KEY?: string
  API_DOMAIN: string
  SESSIONS_BROADCAST: DurableObjectNamespace<SessionBroadcastType>
}

function isAuthorizedRpcRequest(c: { req: { header: (name: string) => string | undefined }; env: Env }) {
  const configured = c.env.SESSIONS_RPC_SHARED_KEY
  if (!configured) return true
  const received = c.req.header("x-opencode-share-key")
  return received === configured
}

function isAuthorizedAdminRequest(c: { req: { header: (name: string) => string | undefined }; env: Env }) {
  // The admin key reuses the same SESSIONS_RPC_SHARED_KEY env var.
  // If it is not configured the endpoint is inaccessible to prevent
  // unauthenticated enumeration of all sessions.
  const configured = c.env.SESSIONS_RPC_SHARED_KEY
  if (!configured) return false
  const received = c.req.header("x-opencode-share-key")
  return received === configured
}

/**
 * Main Hono application
 */
const app = new Hono<{ Bindings: Env }>()

// Enable CORS for API routes only (not for WebSocket or HTML routes)
app.use("/api/*", cors())

app.all("/rpc/share", async (c) => {
  if (!isAuthorizedRpcRequest(c)) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  return newWorkersRpcResponse(c.req.raw, new ShareRpcImpl(c.env))
})

/**
 * Create a storage adapter from the R2 bucket binding
 */
function getStorageAdapter(c: any): {
  sessions: StorageAdapter<AgentSession>
  index: StorageAdapter<SessionIndex>
} {
  const bucket = c.env.SESSIONS_STORE
  return {
    sessions: createStorageAdapter<AgentSession>(bucket),
    index: createStorageAdapter<SessionIndex>(bucket),
  }
}

/**
 * Root redirect
 */
app.get("/", (c) => c.redirect("/sessions"))

/**
 * Create a new share
 * POST /api/share
 */
app.post(
  "/api/share",
  zValidator(
    "json",
    z.object({
      sessionID: z.string(),
    }),
  ),
  async (c) => {
    const { sessionID } = c.req.valid("json")
    const { sessions, index } = getStorageAdapter(c)

    const shareID = sessionID.slice(-8)

    const shareSecret = uuidv5(sessionID, c.env.SESSIONS_SHARED_SECRET)
    const now = Date.now()

    const info: SyncInfo = {
      id: shareID,
      secret: shareSecret,
      url: `https://${c.env.API_DOMAIN}/share/${shareID}`,
    }

    // Create share credentials
    const credentialsData: ShareCredentials = {
      ...info, // Automatically includes id, secret, and sessionID
      sessionID: sessionID,
      createdAt: now,
    }

    // Initialize empty session data
    const initialSession: AgentSession = {
      session: {
        id: sessionID,
        slug: sessionID,
        projectID: "",
        directory: "",
        title: "",
        version: "1",
        time: {
          created: now,
          updated: now,
        },
      },
      messages: [],
      parts: [],
      diffs: [],
      models: [],
      metadata: {
        createdAt: credentialsData.createdAt,
        lastUpdated: now,
        syncCount: 0,
        secret: shareSecret,
        sessionID: sessionID,
      },
    }

    const initialIndex: SessionIndex = {
      id: shareID,
      sessionID,
      title: "",
      directory: "",
      messageCount: 0,
      partCount: 0,
      diffCount: 0,
      modelCount: 0,
      lastUpdated: now,
      syncCount: 0,
      createdAt: now,
    }

    await Promise.all([sessions.put(`share/${shareID}`, initialSession), index.put(`index/${shareID}`, initialIndex)])

    return c.json(info)
  },
)

/**
 * Sync data to a share
 * POST /api/share/:id/sync
 */
app.post(
  "/api/share/:id/sync",
  zValidator(
    "json",
    z.object({
      secret: z.string(),
      data: z.array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("session"), data: z.any() }),
          z.object({ type: z.literal("message"), data: z.any() }),
          z.object({ type: z.literal("part"), data: z.any() }),
          z.object({ type: z.literal("session_diff"), data: z.array(z.any()) }),
          z.object({ type: z.literal("model"), data: z.array(z.any()) }),
        ]),
      ),
    }),
  ),
  async (c) => {
    const shareID = c.req.param("id")
    const { secret, data } = c.req.valid("json")
    const { sessions, index } = getStorageAdapter(c)

    const agentSession = await sessions.get(`share/${shareID}`)
    if (!agentSession) {
      return c.json({ error: "Share not found" }, 404)
    }

    if (agentSession.metadata.secret !== secret) {
      return c.json({ error: "Invalid secret" }, 403)
    }

    const now = Date.now()
    const nextSession: AgentSession = {
      ...agentSession,
      metadata: {
        ...agentSession.metadata,
        lastUpdated: now,
        syncCount: agentSession.metadata.syncCount + 1,
      },
    }

    for (const item of data) {
      if (item.type === "session") {
        nextSession.session = item.data
        continue
      }

      if (item.type === "message") {
        const index = nextSession.messages.findIndex((message) => message.id === item.data.id)
        if (index === -1) {
          nextSession.messages.push(item.data)
          continue
        }
        nextSession.messages[index] = item.data
        continue
      }

      if (item.type === "part") {
        const index = nextSession.parts.findIndex((part) => part.id === item.data.id)
        if (index === -1) {
          nextSession.parts.push(item.data)
          continue
        }
        nextSession.parts[index] = item.data
        continue
      }

      if (item.type === "session_diff") {
        nextSession.diffs = [...nextSession.diffs, ...item.data]
        continue
      }

      if (item.type === "model") {
        for (const model of item.data) {
          const index = nextSession.models.findIndex((entry) => entry.id === model.id)
          if (index === -1) {
            nextSession.models.push(model)
            continue
          }
          nextSession.models[index] = model
        }
      }
    }

    const updatedIndex: SessionIndex = {
      id: shareID,
      sessionID: nextSession.session.id,
      title: nextSession.session.title,
      directory: nextSession.session.directory,
      messageCount: nextSession.messages.length,
      partCount: nextSession.parts.length,
      diffCount: nextSession.diffs.length,
      modelCount: nextSession.models.length,
      lastUpdated: now,
      syncCount: nextSession.metadata.syncCount,
      createdAt: nextSession.metadata.createdAt,
    }

    await Promise.all([sessions.put(`share/${shareID}`, nextSession), index.put(`index/${shareID}`, updatedIndex)])

    // Notify connected WebSocket viewers
    const doID = c.env.SESSIONS_BROADCAST.idFromName(shareID)
    const stub = c.env.SESSIONS_BROADCAST.get(doID)
    await stub.broadcast(data)

    return c.json({ success: true, syncCount: nextSession.metadata.syncCount })
  },
)

/**
 * Get a complete agent session
 * GET /api/share/:id/data
 */
app.get("/api/share/:id", async (c) => {
  const shareID = c.req.param("id")
  const { sessions } = getStorageAdapter(c)

  // Get session data using storage adapter
  const agentSession = await sessions.get(`share/${shareID}`)
  if (!agentSession) {
    return c.json({ error: "Session not found" }, 404)
  }

  // Return the complete session as typed cryptobject
  return c.json(agentSession, 200, {
    "Content-Type": "application/json",
  })
})

app.delete("/api/share/:id", zValidator("json", z.object({ secret: z.string() })), async (c) => {
  const shareID = c.req.param("id")
  const { secret } = c.req.valid("json")
  const { sessions, index } = getStorageAdapter(c)

  const agentSession = await sessions.get(`share/${shareID}`)
  if (!agentSession) {
    return c.json({ error: "Share not found" }, 404)
  }

  if (agentSession.metadata.secret !== secret) {
    return c.json({ error: "Invalid secret" }, 403)
  }

  await Promise.all([sessions.delete(`share/${shareID}`), index.delete(`index/${shareID}`)])

  return c.json({ success: true })
})

/**
 * Get session metadata (without secret verification)
 * GET /api/share/:id/metadata
 */
app.get("/api/share/:id/metadata", async (c) => {
  const shareID = c.req.param("id")
  const { index } = getStorageAdapter(c)

  const entry = await index.get(`index/${shareID}`)
  if (!entry) {
    return c.json({ error: "Session not found" }, 404)
  }

  return c.json(entry)
})

/**
 * List all sessions (admin endpoint — requires SESSIONS_RPC_SHARED_KEY)
 * GET /api/sessions
 */
app.get("/api/sessions", async (c) => {
  if (!isAuthorizedAdminRequest(c)) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const { index } = getStorageAdapter(c)
  const list = await index.list({ prefix: "index/" })

  const sessions = await Promise.all(list.map((item) => index.get(item.key)))

  const result = sessions.filter((s): s is SessionIndex => s !== null)
  return c.json({ sessions: result, count: result.length })
})

/**
 * API 404 handler
 */
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404))

// ─── HTML Views ──────────────────────────────────────────────

/**
 * Session list page
 * GET /sessions
 */
app.get("/sessions", async (c) => {
  const { index } = getStorageAdapter(c)
  const list = await index.list({ prefix: "index/" })

  const entries = await Promise.all(list.map((item) => index.get(item.key)))

  const sessions = entries.filter((s): s is SessionIndex => s !== null).sort((a, b) => b.lastUpdated - a.lastUpdated)

  return c.html(<SessionList sessions={sessions} />)
})

/**
 * Session detail page
 * GET /share/:id
 */
app.get("/share/:id", async (c) => {
  const shareID = c.req.param("id")
  const storage = getStorageAdapter(c)

  const agentSession = await storage.sessions.get(`share/${shareID}`)
  if (!agentSession) {
    return c.html(<NotFound />, 404)
  }

  return c.html(<SessionDetail session={agentSession} shareID={shareID} />)
})

/**
 * WebSocket upgrade — proxied to Durable Object
 * GET /ws/:id
 */
app.get("/ws/:id", async (c) => {
  const upgrade = c.req.header("Upgrade")
  const connection = c.req.header("Connection")
  if (
    !upgrade ||
    upgrade.toLowerCase() !== "websocket" ||
    !connection ||
    !connection.toLowerCase().includes("upgrade")
  ) {
    return c.text("Expected WebSocket upgrade", 426)
  }

  const shareID = c.req.param("id")
  const doID = c.env.SESSIONS_BROADCAST.idFromName(shareID)
  const stub = c.env.SESSIONS_BROADCAST.get(doID)
  return stub.fetch(c.req.raw)
})

export default app
