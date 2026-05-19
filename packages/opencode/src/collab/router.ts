/**
 * Collab HTTP router — intercepts /collab/* requests before the Effect handler.
 *
 * Routes:
 *   GET  /collab/auth/github             → start GitHub OAuth flow
 *   GET  /collab/auth/github/callback    → exchange code, set session cookie, redirect
 *   GET  /collab/invite/:token           → validate invite, org check, add participant, redirect
 *   GET  /collab/session                 → list sessions (JSON)
 *   POST /collab/session                 → create session (JSON)
 *   GET  /collab/session/:id             → get session (JSON)
 *   DELETE /collab/session/:id          → soft-delete session
 *   GET  /collab/session/:id/repos       → list org repos available to add
 *   POST /collab/session/:id/invite      → create invite link
 *   POST /collab/session/:id/prompt      → Driver submits prompt (enqueue / submitToPool)
 *   POST /collab/session/:id/suggest     → Contributor submits suggestion
 *   POST /collab/session/:id/approve/:sid → Driver approves suggestion
 *   POST /collab/session/:id/reject/:sid  → Driver rejects suggestion
 *   POST /collab/session/:id/vote/:sid    → non-Viewer casts vote
 *   POST /collab/session/:id/resolve      → Driver resolves vote pool
 *   PUT  /collab/session/:id/participant/:ghId/role → change role
 *   GET  /collab/session/:id/events      → SSE stream of CollabEvents
 */

import { randomBytes } from "crypto"
import {
  buildOAuthUrl,
  exchangeCodeForToken,
  getGitHubUser,
  isOrgMember,
  listOrgRepos,
} from "./github-auth"
import * as Session from "./session"
import * as Participant from "./participant"
import * as Invite from "./invite"
import * as Queue from "@opencode-ai/collab"
import * as Room from "./room"
import { runCollabMigrations } from "./migrate"
import { collabDb } from "./db-impl"
import { initSessionWorkspace, cleanupSessionWorkspace } from "./workspace"
import type { CollabEvent } from "@opencode-ai/collab"
import { Database } from "@/storage/db"
import { CollabAuthSessionTable } from "./schema.sql"
import { eq, gt } from "drizzle-orm"

// ── Native session execution ────────────────────────────────────────────────────
// Sends a prompt to the underlying opencode session, creating it first if needed.

async function executePromptOnNativeSession(
  collabSession: ReturnType<typeof Session.getCollabSession> & {},
  content: string,
  workspacePath: string,
): Promise<void> {
  let sessionId = collabSession.sessionId

  // Create the native session on first prompt if not yet linked
  if (!sessionId) {
    const createRes = await fetch("http://localhost:4096/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      // Pass workspace path via query param
    })
    if (!createRes.ok) {
      console.error("[collab] failed to create native session:", await createRes.text())
      return
    }
    const created = (await createRes.json()) as { id: string }
    sessionId = created.id
    Session.linkNativeSession(collabSession.id, sessionId)
    broadcastSse(collabSession.id, {
      type: "collab:native_session_linked" as any,
      sessionId,
    })
  }

  // Send the prompt to the native session (async — don't block the HTTP response)
  fetch(`http://localhost:4096/api/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [{ type: "text", text: content }] }),
  }).catch((err) => {
    console.error("[collab] failed to send prompt to native session:", err)
  })
}

// ── Config ──────────────────────────────────────────────────────────────────────

function cfg() {
  return {
    clientId: process.env["GITHUB_OAUTH_CLIENT_ID"] ?? "",
    clientSecret: process.env["GITHUB_OAUTH_CLIENT_SECRET"] ?? "",
    orgName: process.env["GITHUB_ORG_NAME"] ?? "",
    serverToken: process.env["GITHUB_TOKEN"] ?? "",
    baseUrl: (process.env["OPENCODE_BASE_URL"] ?? "http://localhost:4096").replace(/\/$/, ""),
    sessionSecret: process.env["SESSION_SECRET"] ?? "dev-secret-change-me",
  }
}

// ── Migrations run once ─────────────────────────────────────────────────────────

let migrated = false
function ensureMigrated() {
  if (migrated) return
  runCollabMigrations()
  migrated = true
}

// ── Cookie-based session store (SQLite-backed — survives server restarts) ───────

interface CookieSession {
  githubAccessToken: string
  githubId: number
  githubLogin: string
  githubAvatarUrl: string
  state?: string
}

function getSession(req: Request): CookieSession | null {
  const cookie = parseCookies(req.headers.get("cookie") ?? "")
  const sid = cookie["collab_sid"]
  if (!sid) return null
  return Database.use((db) => {
    const row = db
      .select()
      .from(CollabAuthSessionTable)
      .where(eq(CollabAuthSessionTable.token, sid))
      .get()
    if (!row) return null
    // Reject expired sessions
    if (row.expires_at < Date.now()) {
      db.delete(CollabAuthSessionTable).where(eq(CollabAuthSessionTable.token, sid)).run()
      return null
    }
    return {
      githubAccessToken: row.github_access_token,
      githubId: row.github_id,
      githubLogin: row.github_login,
      githubAvatarUrl: row.github_avatar_url,
    }
  })
}

function setSession(session: CookieSession): { token: string; header: string } {
  const token = randomBytes(32).toString("hex")
  const now = Date.now()
  const expiresAt = now + 7 * 24 * 3600 * 1000
  Database.use((db) => {
    db.insert(CollabAuthSessionTable).values({
      token,
      github_id: session.githubId,
      github_login: session.githubLogin,
      github_avatar_url: session.githubAvatarUrl,
      github_access_token: session.githubAccessToken,
      created_at: now,
      expires_at: expiresAt,
    }).run()
  })
  return {
    token,
    header: `collab_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
  }
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k) out[k.trim()] = decodeURIComponent(v.join("="))
  }
  return out
}

// ── SSE connection store ────────────────────────────────────────────────────────

const sseClients = new Map<string, Set<(e: CollabEvent) => void>>()

function registerSse(collabSessionId: string, send: (e: CollabEvent) => void): () => void {
  if (!sseClients.has(collabSessionId)) sseClients.set(collabSessionId, new Set())
  sseClients.get(collabSessionId)!.add(send)
  return () => sseClients.get(collabSessionId)?.delete(send)
}

export function broadcastSse(collabSessionId: string, event: CollabEvent) {
  sseClients.get(collabSessionId)?.forEach((send) => {
    try {
      send(event)
    } catch {
      sseClients.get(collabSessionId)?.delete(send)
    }
  })
}

// ── Main handler ────────────────────────────────────────────────────────────────

export function handleCollabRequest(req: Request): Promise<Response> {
  return Promise.resolve()
    .then(() => handleCollabRequestInner(req))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      console.error("[collab] unhandled error:", stack ?? message)
      return json({ error: "Internal server error", detail: message }, 500)
    })
}

function handleCollabRequestInner(req: Request): Promise<Response> | Response {
  ensureMigrated()
  const url = new URL(req.url, "http://localhost")
  const path = url.pathname

  // OAuth start
  if (req.method === "GET" && path === "/collab/auth/github") {
    const c = cfg()
    const state = randomBytes(16).toString("hex")
    const next = url.searchParams.get("next") ?? ""
    const oauthUrl = buildOAuthUrl({
      clientId: c.clientId,
      redirectUri: `${c.baseUrl}/collab/auth/github/callback`,
      state,
      scopes: ["read:org", "read:user"],
    })
    const cookies = [
      `collab_oauth_state=${state}; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=600`,
    ]
    if (next) {
      cookies.push(`collab_next=${encodeURIComponent(next)}; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=600`)
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: oauthUrl,
        "Set-Cookie": cookies.join(", "),
      },
    })
  }

  // OAuth callback
  if (req.method === "GET" && path === "/collab/auth/github/callback") {
    return handleOAuthCallback(req, url)
  }

  // Invite redemption
  if (req.method === "GET" && path.startsWith("/collab/invite/")) {
    const token = path.slice("/collab/invite/".length)
    return handleInviteRedeem(req, token)
  }

  // GET /collab/repos — list org repos (auth required, no session needed)
  if (req.method === "GET" && path === "/collab/repos") {
    const sess = getSession(req)
    if (!sess) return json({ error: "Unauthorised — please authenticate via /collab/auth/github" }, 401)
    const c = cfg()
    return listOrgRepos({ orgName: c.orgName, serverToken: c.serverToken }).then((repos) => json(repos))
  }

  // GET /collab/me — current authenticated user info
  if (req.method === "GET" && path === "/collab/me") {
    const sess = getSession(req)
    if (!sess) return json({ error: "Unauthorised" }, 401)
    return json({ githubId: sess.githubId, githubLogin: sess.githubLogin, githubAvatarUrl: sess.githubAvatarUrl })
  }

  // REST API — require auth for all /collab/session/* routes
  if (path.startsWith("/collab/session")) {
    return handleSessionRoutes(req, url, path)
  }

  return json({ error: "Not found" }, 404)
}

// ── OAuth callback ───────────────────────────────────────────────────────────────

async function handleOAuthCallback(req: Request, url: URL): Promise<Response> {
  const c = cfg()
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  if (!code) return json({ error: "Missing OAuth code" }, 400)

  const cookieState = parseCookies(req.headers.get("cookie") ?? "")["collab_oauth_state"]
  if (!cookieState || cookieState !== state) {
    return json({ error: "Invalid OAuth state" }, 400)
  }

  try {
    const accessToken = await exchangeCodeForToken({
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      code,
      redirectUri: `${c.baseUrl}/collab/auth/github/callback`,
    })

    const ghUser = await getGitHubUser(accessToken)

    // Check org membership
    const isMember = await isOrgMember({
      orgName: c.orgName,
      githubLogin: ghUser.login,
      serverToken: c.serverToken,
    })
    if (!isMember) {
      return html(
        `<h1>Access denied</h1><p>You must be a member of the <strong>${c.orgName}</strong> GitHub organisation to use this tool.</p>`,
        403,
      )
    }

    const { header } = setSession({
      githubAccessToken: accessToken,
      githubId: ghUser.id,
      githubLogin: ghUser.login,
      githubAvatarUrl: ghUser.avatar_url,
    })

    // Determine post-auth redirect: pending invite > ?next param > /collab/new
    const cookies = parseCookies(req.headers.get("cookie") ?? "")
    const pending = cookies["collab_pending_invite"]
    const nextParam = cookies["collab_next"] ? decodeURIComponent(cookies["collab_next"]) : null
    const location = pending ? `/collab/invite/${pending}` : (nextParam ?? "/collab/new")

    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        "Set-Cookie": header,
      },
    })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
}

// ── Invite redemption ────────────────────────────────────────────────────────────

async function handleInviteRedeem(req: Request, token: string): Promise<Response> {
  const sess = getSession(req)
  if (!sess) {
    // Redirect to OAuth; store pending invite in cookie
    const c = cfg()
    const state = randomBytes(16).toString("hex")
    const oauthUrl = buildOAuthUrl({
      clientId: c.clientId,
      redirectUri: `${c.baseUrl}/collab/auth/github/callback`,
      state,
    })
    return new Response(null, {
      status: 302,
      headers: {
        Location: oauthUrl,
        "Set-Cookie": [
          `collab_pending_invite=${token}; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=600`,
          `collab_oauth_state=${state}; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=600`,
        ].join(", "),
      },
    })
  }

  const invite = Invite.validateInvite(token)
  if (!invite) {
    return html("<h1>Invalid or expired invite link</h1>", 400)
  }

  const c = cfg()
  const isMember = await isOrgMember({
    orgName: c.orgName,
    githubLogin: sess.githubLogin,
    serverToken: c.serverToken,
  })
  if (!isMember) {
    return html(`<h1>Access denied</h1><p>You must be a member of the ${c.orgName} organisation.</p>`, 403)
  }

  const collabSession = Session.getCollabSession(invite.collabSessionId)
  if (!collabSession) return html("<h1>Session not found</h1>", 404)

  const participant = Participant.addParticipant(invite.collabSessionId, {
    githubId: sess.githubId,
    githubLogin: sess.githubLogin,
    githubAvatarUrl: sess.githubAvatarUrl,
    role: invite.role,
  })

  Invite.redeemInvite(token, sess.githubLogin)

  broadcastSse(invite.collabSessionId, {
    type: "collab:participant_joined",
    participant,
  })

  return new Response(null, {
    status: 302,
    headers: { Location: `/#/collab/${invite.collabSessionId}` },
  })
}

// ── Session REST routes ──────────────────────────────────────────────────────────

async function handleSessionRoutes(req: Request, url: URL, path: string): Promise<Response> {
  const sess = getSession(req)
  if (!sess) {
    return json({ error: "Unauthorised — please authenticate via /collab/auth/github" }, 401)
  }

  const parts = path.split("/").filter(Boolean) // ["collab", "session", ...rest]
  const sessionId = parts[2]

  // GET /collab/session → list sessions
  if (req.method === "GET" && !sessionId) {
    const list = Session.listCollabSessions()
    // Only return sessions the user participates in
    const visible = list.filter((s) =>
      s.participants.some((p) => p.githubId === sess.githubId),
    )
    return json(visible)
  }

  // POST /collab/session → create session
  if (req.method === "POST" && !sessionId) {
    const body = (await req.json()) as {
      name: string
      repos: string[]
      visibilityMode?: string
      queueMode?: string
    }
    const created = Session.createCollabSession({
      name: body.name,
      ownerGithubId: sess.githubId,
      ownerGithubLogin: sess.githubLogin,
      ownerAvatarUrl: sess.githubAvatarUrl,
      repos: body.repos ?? [],
      visibilityMode: (body.visibilityMode as any) ?? "submitted",
      queueMode: (body.queueMode as any) ?? "fifo",
    })
    // Register queue engine for this session
    Queue.registerSession(created.id, collabDb, async (suggestion) => {
      broadcastSse(created.id, { type: "collab:prompt_submitted", suggestion, queuePosition: 0 })
      // Actual LLM execution is handled by the existing opencode session pipeline
      // The collab session is linked to a native session which does the real work
    })
    // Clone selected repos into server workspace (non-blocking)
    if (created.repos.length > 0) {
      initSessionWorkspace(created.id, created.repos).catch((err) => {
        console.error("[collab] workspace init failed:", err)
      })
    }
    return json(created, 201)
  }

  // Routes that require sessionId
  if (!sessionId) return json({ error: "Not found" }, 404)

  const collabSession = Session.getCollabSession(sessionId)
  if (!collabSession) return json({ error: "Session not found" }, 404)

  // Ensure caller is a participant
  const caller = collabSession.participants.find((p) => p.githubId === sess.githubId)
  if (!caller) return json({ error: "Forbidden" }, 403)

  // GET /collab/session/:id
  if (req.method === "GET" && parts.length === 3) {
    return json(collabSession)
  }

  // DELETE /collab/session/:id — Drivers only
  if (req.method === "DELETE" && parts.length === 3) {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    Session.deleteCollabSession(sessionId)
    broadcastSse(sessionId, { type: "collab:session_deleted", collabSessionId: sessionId })
    // Clean up server workspace
    cleanupSessionWorkspace(sessionId)
    return json({ ok: true })
  }

  // GET /collab/session/:id/repos — list org repos
  if (req.method === "GET" && parts[3] === "repos") {
    const c = cfg()
    const repos = await listOrgRepos({ orgName: c.orgName, serverToken: c.serverToken })
    return json(repos)
  }

  // POST /collab/session/:id/invite — Driver only
  if (req.method === "POST" && parts[3] === "invite") {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    const body = (await req.json()) as { role: string; expiresInHours?: number }
    const invite = Invite.createInvite(
      sessionId,
      body.role as any,
      sess.githubLogin,
      body.expiresInHours,
    )
    const c = cfg()
    return json({ ...invite, url: Invite.inviteUrl(c.baseUrl, invite.token) }, 201)
  }

  // POST /collab/session/:id/prompt — Driver submits directly
  if (req.method === "POST" && parts[3] === "prompt") {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    const body = (await req.json()) as { content: string }
    const suggestion =
      collabSession.queueMode === "fifo"
        ? Queue.enqueue(sessionId, body.content, sess.githubId, sess.githubLogin)
        : Queue.submitToPool(sessionId, body.content, sess.githubId, sess.githubLogin)
    const queue = Queue.getQueue(sessionId)
    broadcastSse(sessionId, { type: "collab:queue_update", queue })

    // Execute the prompt on the underlying opencode session (non-blocking)
    const workspacePath = process.env["COLLAB_WORKSPACE_ROOT"] ?? "/var/opencode/workspaces"
    executePromptOnNativeSession(collabSession, body.content, workspacePath).catch(console.error)

    return json(suggestion, 201)
  }

  // POST /collab/session/:id/suggest — Contributor submits suggestion
  if (req.method === "POST" && parts[3] === "suggest") {
    if (caller.role === "viewer") return json({ error: "Forbidden — Viewers cannot suggest" }, 403)
    const body = (await req.json()) as { content: string }
    const suggestion = Queue.submitToPool(sessionId, body.content, sess.githubId, sess.githubLogin)
    broadcastSse(sessionId, { type: "collab:prompt_suggestion", suggestion })
    return json(suggestion, 201)
  }

  // POST /collab/session/:id/approve/:sid — Driver approves suggestion
  if (req.method === "POST" && parts[3] === "approve" && parts[4]) {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    const approved = Queue.approveSuggestion(sessionId, parts[4])
    if (!approved) return json({ error: "Suggestion not found" }, 404)
    broadcastSse(sessionId, { type: "collab:suggestion_approved", suggestionId: parts[4], approvedBy: sess.githubLogin })
    const queue = Queue.getQueue(sessionId)
    broadcastSse(sessionId, { type: "collab:queue_update", queue })

    // Execute the approved suggestion on the native session
    const workspacePath = process.env["COLLAB_WORKSPACE_ROOT"] ?? "/var/opencode/workspaces"
    executePromptOnNativeSession(collabSession, approved.content, workspacePath).catch(console.error)

    return json(approved)
  }

  // POST /collab/session/:id/reject/:sid — Driver rejects suggestion
  if (req.method === "POST" && parts[3] === "reject" && parts[4]) {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    Queue.rejectSuggestion(sessionId, parts[4])
    broadcastSse(sessionId, { type: "collab:suggestion_rejected", suggestionId: parts[4], rejectedBy: sess.githubLogin })
    return json({ ok: true })
  }

  // POST /collab/session/:id/vote/:sid — non-Viewer votes
  if (req.method === "POST" && parts[3] === "vote" && parts[4]) {
    if (caller.role === "viewer") return json({ error: "Forbidden — Viewers cannot vote" }, 403)
    const { newScore } = Queue.castVote(sessionId, parts[4], sess.githubLogin)
    broadcastSse(sessionId, {
      type: "collab:vote_cast",
      suggestionId: parts[4],
      voterLogin: sess.githubLogin,
      newScore,
    })
    return json({ ok: true, newScore })
  }

  // POST /collab/session/:id/resolve — Driver resolves vote pool
  if (req.method === "POST" && parts[3] === "resolve") {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    const winner = Queue.resolvePool(sessionId)
    if (!winner) return json({ error: "No pending suggestions" }, 404)
    broadcastSse(sessionId, { type: "collab:vote_winner", suggestionId: winner.id, content: winner.content })
    const queue = Queue.getQueue(sessionId)
    broadcastSse(sessionId, { type: "collab:queue_update", queue })
    return json(winner)
  }

  // PUT /collab/session/:id/participant/:ghId/role — Driver changes role
  if (req.method === "PUT" && parts[3] === "participant" && parts[5] === "role") {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    const body = (await req.json()) as { role: string }
    Participant.changeRole(sessionId, Number(parts[4]), body.role as any)
    broadcastSse(sessionId, {
      type: "collab:role_changed",
      githubLogin: parts[4]!,
      role: body.role as any,
    })
    return json({ ok: true })
  }

  // GET /collab/session/:id/events — SSE stream
  if (req.method === "GET" && parts[3] === "events") {
    return handleSse(req, sessionId, sess)
  }

  return json({ error: "Not found" }, 404)
}

// ── SSE stream handler ──────────────────────────────────────────────────────────

function handleSse(
  _req: Request,
  collabSessionId: string,
  sess: { githubId: number; githubLogin: string },
): Response {
  // Mark participant online
  const collabSession = Session.getCollabSession(collabSessionId)
  if (collabSession) {
    Participant.setOnline(collabSessionId, sess.githubId, true)
    const participant = collabSession.participants.find((p) => p.githubId === sess.githubId)
    if (participant) {
      broadcastSse(collabSessionId, { type: "collab:participant_joined", participant: { ...participant, isOnline: true } })
    }
  }

  let unregister: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (event: CollabEvent) => {
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))
        } catch {
          unregister?.()
        }
      }
      // Send current session state immediately
      const current = Session.getCollabSession(collabSessionId)
      if (current) {
        send({ type: "collab:queue_update", queue: Queue.getQueue(collabSessionId) })
      }
      unregister = registerSse(collabSessionId, send)
    },
    cancel() {
      unregister?.()
      Participant.setOnline(collabSessionId, sess.githubId, false)
      broadcastSse(collabSessionId, { type: "collab:participant_left", githubLogin: sess.githubLogin })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function html(body: string, status = 200): Response {
  return new Response(`<!DOCTYPE html><html><body>${body}</body></html>`, {
    status,
    headers: { "Content-Type": "text/html" },
  })
}
