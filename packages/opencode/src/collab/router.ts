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
import {
  initSessionWorkspace,
  cleanupSessionWorkspace,
  sessionWorkspacePath,
  nativeSessionDirectory,
  readRepoBranches,
} from "./workspace"
import { readFile } from "node:fs/promises"
import { openCollabPullRequest } from "./github-pr"
import { toggleReaction, isAllowedEmoji } from "./reactions"
import { mentionsToEvents } from "./mentions"
import { insertNote, listRecentNotes } from "./notes"
import { nativeFetch } from "./native-api"
import { encryptToken, decryptToken, isEncrypted } from "./crypto"

/**
 * Read TCP ports the container is currently LISTENING on, by parsing
 * /proc/net/tcp + /proc/net/tcp6.  Filters out:
 *   - non-LISTEN states (only state 0A = LISTEN)
 *   - opencode's own port (4096)
 *   - ports under 1024 (system services)
 *   - well-known DB ports we definitely don't want to expose (5432, 6379, etc.)
 *
 * Used by the left-panel "Live preview" chip strip — each port becomes a
 * link to /preview/<port>/.
 */
async function readListeningPorts(): Promise<number[]> {
  const exclude = new Set([4096, 5432, 6379, 9229, 3306, 27017])
  const found = new Set<number>()
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const text = await readFile(file, "utf8")
      const lines = text.split("\n").slice(1) // skip header
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 4) continue
        const local = parts[1]
        const state = parts[3]
        if (state !== "0A") continue // LISTEN only
        const portHex = local!.split(":").pop()!
        const port = parseInt(portHex, 16)
        if (!Number.isInteger(port)) continue
        if (port < 1024 || port > 65535) continue
        if (exclude.has(port)) continue
        found.add(port)
      }
    } catch {
      // /proc/net/tcp6 might not exist on IPv6-disabled hosts; ignore.
    }
  }
  return [...found].sort((a, b) => a - b)
}
import type { CollabEvent } from "@opencode-ai/collab"

/**
 * Register the queue executor for a collab session.
 *
 * The executor is called by _scheduleNext whenever a suggestion reaches
 * "approved" status.  It immediately marks the suggestion as "submitted"
 * (removing it from the approved queue so the loop doesn't repeat) and
 * then dispatches the prompt to the native opencode session.
 *
 * This must be called:
 *   1. At session creation (POST /collab/session)
 *   2. From ensureQueueRegistered — handles server restarts where in-memory
 *      queue state is lost but DB sessions survive.
 */
function registerQueueExecutor(collabSessionId: string): void {
  Queue.registerSession(collabSessionId, collabDb, async (suggestion) => {
    // Mark "submitted" immediately — this removes the suggestion from
    // getApprovedQueue so _scheduleNext won't call us again for this item.
    collabDb.updateSuggestionStatus(suggestion.id, "submitted")

    // Notify listeners that the prompt is being processed
    broadcastSse(collabSessionId, {
      type: "collab:prompt_submitted",
      suggestion: { ...suggestion, status: "submitted" },
      queuePosition: 0,
    })

    // Dispatch to native opencode session.  Single-repo sessions hand opencode
    // the repo subdir directly (so git diff / review pane see a real repo).
    const cs = Session.getCollabSession(collabSessionId)
    if (!cs) return
    const workspacePath = nativeSessionDirectory(collabSessionId, cs.repos)
    await executePromptOnNativeSession(cs, suggestion.content, workspacePath)
  })
}

function ensureQueueRegistered(collabSessionId: string) {
  try {
    Queue.getQueue(collabSessionId)
  } catch {
    // Session not yet registered (server restart) — register with full executor
    registerQueueExecutor(collabSessionId)
  }
}
import { Database } from "@/storage/db"
import { CollabAuthSessionTable } from "./schema.sql"
import { eq, gt } from "drizzle-orm"

// ── Native session execution ────────────────────────────────────────────────────
// Sends a prompt to the underlying opencode session, creating it first if needed.
//
// ⚠️  Self-HTTP calls (fetch to localhost:4096) within the server process can
//     block the Bun/Node event loop if the receiving handler triggers
//     @npmcli/arborist to install packages synchronously.  To avoid this:
//
//  1. The Dockerfile pre-installs opencode-claude-auth so Npm.add() is a fast
//     cache-hit at runtime (no arborist.reify needed).
//  2. We pre-warm the native session at COLLAB SESSION CREATION time
//     (preWarmNativeSession), so by the time the user clicks Approve the
//     InstanceStore for the workspace directory is already bootstrapped and
//     collabSession.sessionId is set.  The approve path then only needs the
//     lightweight prompt_async call.

/**
 * Ensure a native opencode session exists for the given workspace path,
 * creating one if necessary.  Stores the result in the collab session and
 * broadcasts `collab:native_session_linked`.
 *
 * Returns the native session ID, or null on failure.
 *
 * In-flight deduplication: concurrent callers (pre-warm + the queue executor
 * triggered by a fast first user submit) would otherwise race and create
 * multiple native sessions for the same workspace, with the prompt landing
 * in whichever the executor used while the iframe ended up pointed at the
 * other.  We keep a per-collab-session Promise so a second caller awaits
 * the first one's result.
 */
const inFlightCreate = new Map<string, Promise<string | null>>()

async function ensureNativeSession(
  collabSessionId: string,
  workspacePath: string,
): Promise<string | null> {
  const collabSession = Session.getCollabSession(collabSessionId)
  if (!collabSession) return null

  // Fast path: session already created
  if (collabSession.sessionId) return collabSession.sessionId

  // Concurrent caller? Reuse the existing in-flight create.
  const pending = inFlightCreate.get(collabSessionId)
  if (pending) return pending

  const createPromise = (async (): Promise<string | null> => {
    const { mkdirSync } = await import("fs")
    mkdirSync(workspacePath, { recursive: true })

    console.log("[collab] creating native session for directory:", workspacePath)
    const createRes = await nativeFetch(
      `/session?directory=${encodeURIComponent(workspacePath)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Pass the collab session name through as the opencode session title
        // so the right-hand pane shows "Fix login bug" instead of "New Session".
        body: JSON.stringify({ title: collabSession.name }),
      },
    )
    if (!createRes.ok) {
      const body = await createRes.text()
      console.error("[collab] failed to create native session:", createRes.status, body)
      return null
    }
    const created = (await createRes.json()) as { id: string }
    console.log("[collab] native session created:", created.id)

    // Persist the link and notify all connected clients
    Session.linkNativeSession(collabSessionId, created.id)
    broadcastSse(collabSessionId, {
      type: "collab:native_session_linked",
      sessionId: created.id,
      directory: workspacePath,
    })

    return created.id
  })()

  inFlightCreate.set(collabSessionId, createPromise)
  try {
    return await createPromise
  } finally {
    inFlightCreate.delete(collabSessionId)
  }
}

/**
 * Pre-warms the native opencode session shortly after a collab session is
 * created.  This moves the slow InstanceStore.load / plugin bootstrap out of
 * the approve-click hot-path so approvals are near-instant.
 *
 * Runs fire-and-forget after a small delay to let the collab session creation
 * HTTP response flush before we make the self-fetch.
 */
function preWarmNativeSession(collabSessionId: string, workspacePath: string): void {
  setTimeout(async () => {
    const cs = Session.getCollabSession(collabSessionId)
    if (!cs) return // session already deleted
    if (cs.sessionId) return // already pre-warmed

    console.log("[collab] pre-warming native session for collab session:", collabSessionId)
    try {
      const nativeSessionId = await ensureNativeSession(collabSessionId, workspacePath)
      console.log("[collab] native session pre-warm complete for:", collabSessionId)

      // Fire a seed prompt so the LLM has context about being in a collab
      // session AND so the iframe immediately renders a conversation
      // (instead of an empty new-session view) when the user opens the page.
      if (nativeSessionId) {
        await sendSeedPrompt(nativeSessionId, workspacePath, cs.name, cs.repos, cs.branch)
      }
    } catch (err) {
      // Non-fatal: the approve path will retry
      console.error("[collab] native session pre-warm failed:", err)
    }
  }, 200) // 200 ms gives the creation response time to flush
}

/**
 * Send a single seed prompt to the freshly-created native opencode session.
 * Establishes context for the LLM (it's in a multi-user collab session and
 * prompts come through a shared queue) and produces an immediate visible
 * conversation in the iframe so users aren't staring at an empty composer.
 */
async function sendSeedPrompt(
  nativeSessionId: string,
  workspacePath: string,
  sessionName: string,
  repos: string[],
  branch: string | null,
): Promise<void> {
  const reposLine =
    repos.length > 0
      ? `Linked repositories (cloned at ${workspacePath}): ${repos.join(", ")}`
      : `No repositories linked to this session.`
  const branchLine = branch
    ? `Working on git branch: ${branch}.  Every commit you make here will land on this branch.`
    : `No collab branch configured — commits will land on whatever branch is currently checked out.`
  const seed = [
    `Starting a collab session: "${sessionName}".`,
    "",
    reposLine,
    branchLine,
    "",
    "This is a real-time collaborative coding session.  Multiple developers " +
      "share this conversation through a queue — Drivers can dispatch prompts " +
      "directly to you, Contributors submit suggestions for a Driver to " +
      "approve, and Viewers read along.  Every git commit you make inside the " +
      "workspace is auto-tagged with the collab session metadata via a " +
      "prepare-commit-msg hook installed in each cloned repo.",
    "",
    "Acknowledge readiness in one short sentence — no analysis yet.  The next " +
      "prompt from a team member will tell you what to work on.",
  ].join("\n")

  try {
    const res = await nativeFetch(
      `/session/${nativeSessionId}/prompt_async?directory=${encodeURIComponent(workspacePath)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: seed }] }),
      },
    )
    if (!res.ok) {
      console.error("[collab] seed prompt failed:", res.status, await res.text().catch(() => ""))
    } else {
      console.log("[collab] seed prompt sent for:", nativeSessionId)
    }
  } catch (err) {
    console.error("[collab] seed prompt error:", err)
  }
}

/**
 * Dispatches an approved prompt to the native opencode session.
 * The native session must already exist (pre-warmed at creation time);
 * if it doesn't, we create it inline as a fallback.
 */
async function executePromptOnNativeSession(
  collabSession: NonNullable<ReturnType<typeof Session.getCollabSession>>,
  content: string,
  workspacePath: string,
): Promise<void> {
  const nativeSessionId = await ensureNativeSession(collabSession.id, workspacePath)
  if (!nativeSessionId) {
    console.error("[collab] cannot dispatch prompt — no native session available")
    return
  }

  console.log("[collab] sending prompt to native session:", nativeSessionId)
  const promptRes = await nativeFetch(
    `/session/${nativeSessionId}/prompt_async?directory=${encodeURIComponent(workspacePath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text: content }] }),
    },
  )
  if (!promptRes.ok) {
    const body = await promptRes.text()
    console.error("[collab] failed to send prompt:", promptRes.status, body)
  } else {
    console.log("[collab] prompt dispatched to native session:", nativeSessionId)
  }
}

// ── Config ──────────────────────────────────────────────────────────────────────

function cfg() {
  return {
    clientId: process.env["GITHUB_OAUTH_CLIENT_ID"] ?? "",
    clientSecret: process.env["GITHUB_OAUTH_CLIENT_SECRET"] ?? "",
    orgName: process.env["GITHUB_ORG_NAME"] ?? "",
    baseUrl: (process.env["OPENCODE_BASE_URL"] ?? "http://localhost:4096").replace(/\/$/, ""),
    sessionSecret: process.env["SESSION_SECRET"] ?? "dev-secret-change-me",
  }
  // serverToken (GITHUB_TOKEN PAT) was removed in ADR-0005 Option B —
  // every GitHub call now uses the caller's OAuth access token from their
  // collab_auth_session row.  See packages/opencode/src/collab/github-auth.ts
  // and workspace.ts / github-pr.ts.
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
    // Decrypt the at-rest token (ADR-0004).  Plaintext rows from a
    // pre-migration boot fall through to .github_access_token directly.
    let accessToken = row.github_access_token
    if (isEncrypted(accessToken)) {
      const plain = decryptToken(accessToken, cfg().sessionSecret)
      if (plain === null) {
        // Decrypt-failure policy (CONTEXT.md → Cookie Authorization Scope):
        // treat as "session not found", delete the row defensively, and
        // log a single WARN line.  Rotating SESSION_SECRET intentionally
        // invalidates every active cookie — re-OAuth recovers.
        console.warn(
          `[collab.auth] decrypt failed for ${row.github_login}; deleting row, user must re-OAuth`,
        )
        db.delete(CollabAuthSessionTable).where(eq(CollabAuthSessionTable.token, sid)).run()
        return null
      }
      accessToken = plain
    }
    return {
      githubAccessToken: accessToken,
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
  // Encrypt the at-rest token (ADR-0004).  In-memory the plaintext stays
  // available via getSession() so GitHub API calls keep working unchanged.
  const encryptedAccessToken = encryptToken(session.githubAccessToken, cfg().sessionSecret)
  Database.use((db) => {
    db.insert(CollabAuthSessionTable).values({
      token,
      github_id: session.githubId,
      github_login: session.githubLogin,
      github_avatar_url: session.githubAvatarUrl,
      github_access_token: encryptedAccessToken,
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
    const next = url.searchParams.get("next") ?? ""
    // Encode `next` directly into the state so we don't depend on a
    // collab_next cookie surviving the round-trip through GitHub.
    const state = makeOAuthState({ next: next || undefined })
    const oauthUrl = buildOAuthUrl({
      clientId: c.clientId,
      redirectUri: `${c.baseUrl}/collab/auth/github/callback`,
      state,
      // `repo` + `user:email` added by ADR-0005 Option B — the user's OAuth
      // token now does server-side git clone/push/PR/list-repos work, so
      // it needs repo-write scope.  (The default in buildOAuthUrl is the
      // same — this is just an explicit local override that needs to match.)
      scopes: ["read:org", "read:user", "user:email", "repo"],
    })
    const headers = new Headers({ Location: oauthUrl })
    headers.append(
      "Set-Cookie",
      `collab_oauth_state=${state}; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=600`,
    )
    return new Response(null, { status: 302, headers })
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
    return listOrgRepos({ orgName: c.orgName, userToken: sess.githubAccessToken }).then((repos) => json(repos))
  }

  // GET /collab/me — current authenticated user info
  if (req.method === "GET" && path === "/collab/me") {
    const sess = getSession(req)
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" }
    if (!sess) {
      return new Response(JSON.stringify({ error: "Unauthorised" }), { status: 401, headers })
    }
    return new Response(
      JSON.stringify({
        githubId: sess.githubId,
        githubLogin: sess.githubLogin,
        githubAvatarUrl: sess.githubAvatarUrl,
      }),
      { status: 200, headers },
    )
  }

  // REST API — require auth for all /collab/session/* routes
  if (path.startsWith("/collab/session")) {
    return handleSessionRoutes(req, url, path)
  }

  return json({ error: "Not found" }, 404)
}

// ── OAuth callback ───────────────────────────────────────────────────────────────

/**
 * OAuth state is a base64url-encoded JSON envelope:
 *   { n: <nonce>, inv?: <invite-token>, next?: <return-to-url> }
 *
 * GitHub round-trips the `state` query param unchanged, so encoding the
 * pending invite token here lets us recover it on the callback EVEN IF the
 * `collab_pending_invite` cookie is lost or malformed.  We still pair the
 * state with a cookie of the same value for CSRF protection (the attacker
 * has the URL state but can't forge the cookie).
 */
interface OAuthStatePayload {
  n: string
  inv?: string
  next?: string
}
function makeOAuthState(extra: { inv?: string; next?: string } = {}): string {
  const data: OAuthStatePayload = { n: randomBytes(16).toString("hex"), ...extra }
  return Buffer.from(JSON.stringify(data), "utf8").toString("base64url")
}
function parseOAuthState(state: string | null): OAuthStatePayload | null {
  if (!state) return null
  try {
    const json = Buffer.from(state, "base64url").toString("utf8")
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === "object" && typeof parsed.n === "string") return parsed
  } catch {}
  return null
}

async function handleOAuthCallback(req: Request, url: URL): Promise<Response> {
  const c = cfg()
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")
  const oauthErrorDescription = url.searchParams.get("error_description")
  const oauthErrorUri = url.searchParams.get("error_uri")

  console.error("[collab.auth] callback received", {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    oauthError,
    oauthErrorDescription,
    referer: req.headers.get("referer"),
  })

  // GitHub redirects back here with ?error=... when the user denied access,
  // the OAuth app is restricted by an org policy, the app is suspended, etc.
  // Without surfacing this the user just sees a generic "Missing OAuth code"
  // 400 and we have no idea what went wrong server-side.
  if (oauthError) {
    console.error("[collab.auth] GitHub returned an OAuth error", {
      oauthError,
      oauthErrorDescription,
      oauthErrorUri,
    })
    return html(
      `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 4rem auto; padding: 1.5rem; line-height: 1.5;">
          <h1 style="margin: 0 0 0.5rem 0;">GitHub OAuth error</h1>
          <p>GitHub rejected the sign-in with:</p>
          <pre style="background:#111;color:#eee;padding:0.75rem;border-radius:6px;overflow-x:auto;">${oauthError}${
            oauthErrorDescription ? `\n\n${oauthErrorDescription.replace(/</g, "&lt;")}` : ""
          }</pre>
          <p>Common causes:</p>
          <ul>
            <li><strong>access_denied</strong> — you clicked Cancel on the GitHub authorisation screen.</li>
            <li><strong>application_suspended</strong> — the OAuth App has been suspended by GitHub.</li>
            <li><strong>redirect_uri_mismatch</strong> — the configured <code>OPENCODE_BASE_URL</code> doesn't match the OAuth App's registered callback (server admin: fix in OAuth App settings).</li>
            <li>Organisation has restricted OAuth app access and this app isn't on the allowlist — the server admin needs to <a href="https://github.com/orgs/${c.orgName}/policies/applications">request approval</a> or you need to ask an org owner to approve this app for you.</li>
          </ul>
          ${oauthErrorUri ? `<p>GitHub docs: <a href="${oauthErrorUri}">${oauthErrorUri}</a></p>` : ""}
        </div>
      `,
      400,
    )
  }

  if (!code) {
    console.error("[collab.auth] callback missing both code and error params", {
      url: req.url,
    })
    return json({ error: "Missing OAuth code" }, 400)
  }

  const cookieState = parseCookies(req.headers.get("cookie") ?? "")["collab_oauth_state"]
  if (!cookieState || cookieState !== state) {
    console.error("[collab.auth] OAuth state mismatch", {
      hasCookieState: Boolean(cookieState),
      stateMatches: cookieState === state,
    })
    return json({ error: "Invalid OAuth state" }, 400)
  }

  // Decode the envelope.  `inv` and `next` are now self-contained in the
  // state itself, so they survive cookie drops.  We fall back to the legacy
  // `collab_pending_invite` / `collab_next` cookies for any old in-flight
  // OAuth dances that began before this code shipped.
  const decoded = parseOAuthState(state)
  const cookies = parseCookies(req.headers.get("cookie") ?? "")
  const pending = decoded?.inv ?? cookies["collab_pending_invite"]
  const nextFromCookie = cookies["collab_next"] ? decodeURIComponent(cookies["collab_next"]) : null
  const nextParam = decoded?.next ?? nextFromCookie

  let accessToken: string
  try {
    accessToken = await exchangeCodeForToken({
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      code,
      redirectUri: `${c.baseUrl}/collab/auth/github/callback`,
    })
    console.error("[collab.auth] code exchange ok — have user access token")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[collab.auth] code exchange failed", { error: message })
    return html(
      `<h1>OAuth code exchange failed</h1>
       <p>GitHub didn't return an access token.  Check that GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET in the server env actually match the OAuth App's credentials.</p>
       <pre style="background:#111;color:#eee;padding:0.75rem;border-radius:6px;">${message.replace(/</g, "&lt;")}</pre>`,
      500,
    )
  }

  try {
    const ghUser = await getGitHubUser(accessToken)
    console.error("[collab.auth] fetched github user", { login: ghUser.login, id: ghUser.id })

    // Check org membership using the user's own OAuth token.  Works for
    // private members and SSO-protected orgs because /user/memberships/orgs
    // returns the requester's own membership regardless of org visibility.
    const isMember = await isOrgMember({
      orgName: c.orgName,
      githubLogin: ghUser.login,
      userToken: accessToken,
    })
    if (!isMember) {
      console.error("[collab.auth] org membership denied", {
        org: c.orgName,
        login: ghUser.login,
        id: ghUser.id,
      })
      return html(
        `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 4rem auto; padding: 1.5rem; line-height: 1.5;">
            <h1 style="margin: 0 0 0.5rem 0;">Access denied</h1>
            <p>
              You signed in as <strong>${ghUser.login}</strong>, but we couldn't verify that you're a member of the
              <strong>${c.orgName}</strong> GitHub organisation.
            </p>
            <p>If you believe this is wrong, check:</p>
            <ul>
              <li>That <strong>${ghUser.login}</strong> is actually a member of <strong>${c.orgName}</strong> at <a href="https://github.com/orgs/${c.orgName}/people">github.com/orgs/${c.orgName}/people</a>.</li>
              <li>That you authorised the OAuth app for <strong>read:org</strong> scope (you may need to revoke and re-authorise: <a href="https://github.com/settings/applications">github.com/settings/applications</a>).</li>
              <li>If <strong>${c.orgName}</strong> uses SAML/SSO, you may need to authorise the OAuth token for SSO on the same page.</li>
            </ul>
            <p>The server admin can also inspect docker logs for the exact GitHub API status code returned for your account.</p>
          </div>
        `,
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
    const location = pending ? `/collab/invite/${pending}` : (nextParam ?? "/collab/new")

    // Clear all single-use OAuth cookies on the way out so a refresh of the
    // callback URL or a subsequent OAuth dance starts from a clean slate.
    const respHeaders = new Headers({ Location: location })
    respHeaders.append("Set-Cookie", header)
    respHeaders.append("Set-Cookie", `collab_oauth_state=; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=0`)
    respHeaders.append("Set-Cookie", `collab_pending_invite=; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=0`)
    respHeaders.append("Set-Cookie", `collab_next=; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=0`)
    console.error("[collab.auth] login successful, redirecting", { login: ghUser.login, location })
    return new Response(null, { status: 302, headers: respHeaders })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error("[collab.auth] callback inner error", { error: message, stack })
    return html(
      `<h1>Login failed</h1>
       <p>The server hit an unexpected error while completing your sign-in.  Ask the admin to check docker logs.</p>
       <pre style="background:#111;color:#eee;padding:0.75rem;border-radius:6px;">${message.replace(/</g, "&lt;")}</pre>`,
      500,
    )
  }
}

// ── Invite redemption ────────────────────────────────────────────────────────────

async function handleInviteRedeem(req: Request, token: string): Promise<Response> {
  const sess = getSession(req)
  if (!sess) {
    // Bounce through GitHub OAuth.  We encode the invite token DIRECTLY into
    // the OAuth state value (which GitHub round-trips unchanged) — this way
    // the callback can recover the pending invite even if the cookie chain
    // fails for any reason (browser drops cookies on the redirect, paths
    // mismatch, third-party cookie blocking, etc.).  The cookie is still
    // emitted with the same value purely for CSRF (the callback rejects if
    // the URL state doesn't equal the cookie state).
    const c = cfg()
    const state = makeOAuthState({ inv: token })
    const oauthUrl = buildOAuthUrl({
      clientId: c.clientId,
      redirectUri: `${c.baseUrl}/collab/auth/github/callback`,
      state,
    })
    const respHeaders = new Headers({ Location: oauthUrl })
    respHeaders.append(
      "Set-Cookie",
      `collab_oauth_state=${state}; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=600`,
    )
    // Keep the legacy cookie too — belt-and-braces: if the state decode
    // fails for any reason the callback falls back to this cookie.
    respHeaders.append(
      "Set-Cookie",
      `collab_pending_invite=${token}; Path=/collab; HttpOnly; SameSite=Lax; Max-Age=600`,
    )
    return new Response(null, { status: 302, headers: respHeaders })
  }

  const invite = Invite.validateInvite(token)
  if (!invite) {
    return html("<h1>Invalid or expired invite link</h1>", 400)
  }

  const c = cfg()
  const isMember = await isOrgMember({
    orgName: c.orgName,
    githubLogin: sess.githubLogin,
    // The user's own OAuth token is stashed in the session.
    userToken: sess.githubAccessToken,
  })
  if (!isMember) {
    console.error("[collab.auth] invite redeem org membership denied", {
      org: c.orgName,
      login: sess.githubLogin,
      id: sess.githubId,
    })
    return html(
      `<h1>Access denied</h1><p>You must be a member of the <strong>${c.orgName}</strong> organisation to redeem this invite.</p>`,
      403,
    )
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

  // History-based router — the previous hash-prefixed URL ("/#/collab/<id>")
  // made the browser land at "/" (opencode home) because the hash was
  // discarded on the server-side 302 and the SPA never saw the collab path.
  return new Response(null, {
    status: 302,
    headers: { Location: `/collab/${invite.collabSessionId}` },
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
      branch?: string
    }
    const created = Session.createCollabSession({
      name: body.name,
      ownerGithubId: sess.githubId,
      ownerGithubLogin: sess.githubLogin,
      ownerAvatarUrl: sess.githubAvatarUrl,
      repos: body.repos ?? [],
      visibilityMode: (body.visibilityMode as any) ?? "typing",
      queueMode: (body.queueMode as any) ?? "fifo",
      branch: body.branch,
    })
    // Register queue executor — handles dispatch + "submitted" status tracking
    registerQueueExecutor(created.id)

    // Clone repos, THEN pre-warm the native session pointed at the cloned
    // directory.  Sequencing matters: opencode needs the repo on disk before
    // InstanceStore.load — otherwise the file tree, git status, and diff/review
    // pane all start empty.
    const warmupDirectory = nativeSessionDirectory(created.id, created.repos)
    if (created.repos.length > 0) {
      // Pass the session name + branch so initSessionWorkspace can check out
      // the branch and bake the metadata into the per-repo commit hook.
      // Token: the creator's OAuth access token (sess.githubAccessToken),
      // which gets baked into the clone URL.  Subsequent push/pull operations
      // reuse it via .git/config.  See ADR-0005 Option B.
      initSessionWorkspace(created.id, created.repos, sess.githubAccessToken, created.name, created.branch)
        .then(() => preWarmNativeSession(created.id, warmupDirectory))
        .catch((err) => {
          console.error("[collab] workspace init failed:", err)
          // Still pre-warm against the workspace root so the iframe at least loads
          preWarmNativeSession(created.id, sessionWorkspacePath(created.id))
        })
    } else {
      preWarmNativeSession(created.id, warmupDirectory)
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
    // workspacePath is what the client uses to build the iframe URL on page reload.
    // It MUST match the directory we hand to opencode in executePromptOnNativeSession,
    // otherwise the iframe points at a different opencode InstanceStore than the
    // one running the LLM (session-not-found in the iframe).
    //
    // repoBranches: read live from each cloned repo's HEAD so the UI can show
    // the actual current branch — including for legacy sessions where
    // collab_session.branch is null because the column didn't exist yet.
    //
    // Cache-Control: no-store — participant.isOnline flips frequently, we
    // can't risk a stale 200 sitting in a proxy/CDN/browser cache.
    const repoBranches = await readRepoBranches(sessionId, collabSession.repos)
    return new Response(
      JSON.stringify({
        ...collabSession,
        workspacePath: nativeSessionDirectory(sessionId, collabSession.repos),
        repoBranches,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      },
    )
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
    const repos = await listOrgRepos({ orgName: c.orgName, userToken: sess.githubAccessToken })
    return json(repos)
  }

  // GET /collab/session/:id/branches — live current-HEAD per repo.
  // Lightweight endpoint the client polls so the left-panel branch
  // display updates when the LLM (or anyone) does `git checkout`.
  if (req.method === "GET" && parts[3] === "branches") {
    const repoBranches = await readRepoBranches(sessionId, collabSession.repos)
    return new Response(JSON.stringify({ repoBranches }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    })
  }

  // GET /collab/session/:id/preview-ports — list of TCP ports the container
  // is currently listening on (likely dev servers).  Used by the left panel
  // to show a chip per port → click opens https://<host>/preview/<port>/.
  // Reads /proc/net/tcp (and tcp6) and filters to LISTEN state.
  if (req.method === "GET" && parts[3] === "preview-ports") {
    const ports = await readListeningPorts()
    return new Response(JSON.stringify({ ports }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    })
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

  // POST /collab/session/:id/pr — Driver only.  git push + open PR on GitHub.
  if (req.method === "POST" && parts[3] === "pr") {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    const c = cfg()
    console.log("[collab.pr]", { sessionId, login: sess.githubLogin })
    // PR creator = the Driver who clicked the button.  Their OAuth token
    // does the push + PR-open call (ADR-0005 Option B).
    const result = await openCollabPullRequest(collabSession, c.baseUrl, sess.githubAccessToken)
    if (!result.ok) {
      console.error("[collab.pr] failed", { sessionId, status: result.status, error: result.error })
      return json({ error: result.error }, result.status)
    }
    console.log("[collab.pr] opened", { sessionId, url: result.url })
    return json({ url: result.url }, 201)
  }

  // POST /collab/session/:id/prompt — submit a prompt.
  //
  // Routing depends on (queueMode, caller.role):
  //
  //   FIFO  + Driver       → instant dispatch to opencode (no approval needed).
  //                          Queue.enqueue inserts as "approved" and triggers
  //                          _scheduleNext → executor → LLM.
  //
  //   FIFO  + Contributor  → queue as "pending"; a Driver must approve.
  //
  //   Vote  + anyone       → queue as "pending" in the vote pool; Drivers
  //                          resolve via /resolve.  Drivers do NOT get to
  //                          unilaterally bypass voting in vote mode.
  if (req.method === "POST" && parts[3] === "prompt") {
    if (caller.role === "viewer") return json({ error: "Forbidden — Viewers cannot submit prompts" }, 403)
    const body = (await req.json()) as { content: string }
    ensureQueueRegistered(sessionId)

    if (collabSession.queueMode === "fifo" && caller.role === "driver") {
      // Direct dispatch — bypass approval.  Executor handles the rest:
      // marks "submitted", broadcasts collab:prompt_submitted, dispatches.
      const suggestion = Queue.enqueue(sessionId, body.content, sess.githubId, sess.githubLogin)
      // Mention broadcasts even though the suggestion itself won't appear
      // in the pending queue — Bob still gets a ping if @bob was mentioned.
      for (const event of mentionsToEvents({
        text: body.content,
        collabSession,
        authorLogin: sess.githubLogin,
        context: { kind: "suggestion", suggestionId: suggestion.id },
      })) {
        broadcastSse(sessionId, event)
      }
      return json(suggestion, 201)
    }

    // Pending — needs Driver approval (FIFO contributor) or pool resolve (Vote).
    const suggestion = Queue.submitToPool(sessionId, body.content, sess.githubId, sess.githubLogin)
    broadcastSse(sessionId, { type: "collab:prompt_suggestion", suggestion })
    broadcastSse(sessionId, { type: "collab:queue_update", queue: collabDb.getPendingPool(sessionId) })
    for (const event of mentionsToEvents({
      text: body.content,
      collabSession,
      authorLogin: sess.githubLogin,
      suggestionId: suggestion.id,
    })) {
      broadcastSse(sessionId, event)
    }
    return json(suggestion, 201)
  }

  // POST /collab/session/:id/suggest — Contributor submits suggestion
  if (req.method === "POST" && parts[3] === "suggest") {
    if (caller.role === "viewer") return json({ error: "Forbidden — Viewers cannot suggest" }, 403)
    const body = (await req.json()) as { content: string }
    const suggestion = Queue.submitToPool(sessionId, body.content, sess.githubId, sess.githubLogin)
    broadcastSse(sessionId, { type: "collab:prompt_suggestion", suggestion })
    for (const event of mentionsToEvents({
      text: body.content,
      collabSession,
      authorLogin: sess.githubLogin,
      suggestionId: suggestion.id,
    })) {
      broadcastSse(sessionId, event)
    }
    return json(suggestion, 201)
  }

  // POST /collab/session/:id/approve/:sid — Driver approves suggestion → executes
  if (req.method === "POST" && parts[3] === "approve" && parts[4]) {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    ensureQueueRegistered(sessionId)
    const approved = Queue.approveSuggestion(sessionId, parts[4])
    if (!approved) return json({ error: "Suggestion not found" }, 404)
    broadcastSse(sessionId, { type: "collab:suggestion_approved", suggestionId: parts[4], approvedBy: sess.githubLogin })
    broadcastSse(sessionId, { type: "collab:queue_update", queue: collabDb.getPendingPool(sessionId) })
    // LLM dispatch is handled by the queue executor (registerQueueExecutor).
    // Queue.approveSuggestion → _scheduleNext → executor → executePromptOnNativeSession
    return json(approved)
  }

  // POST /collab/session/:id/reject/:sid — Driver rejects suggestion
  if (req.method === "POST" && parts[3] === "reject" && parts[4]) {
    if (caller.role !== "driver") return json({ error: "Forbidden — Drivers only" }, 403)
    Queue.rejectSuggestion(sessionId, parts[4])
    broadcastSse(sessionId, { type: "collab:suggestion_rejected", suggestionId: parts[4], rejectedBy: sess.githubLogin })
    // Refresh the pending pool so the rejected item disappears from the UI.
    // Without this the suggestion stays visible — client handleEvent has no
    // case for collab:suggestion_rejected, only for queue_update.
    broadcastSse(sessionId, { type: "collab:queue_update", queue: collabDb.getPendingPool(sessionId) })
    return json({ ok: true })
  }

  // POST /collab/session/:id/typing — debounced typing indicator
  //
  // Body: { typing: boolean }
  // Broadcasts `collab:typing_start` / `collab:typing_stop` so other clients
  // can render a "[name] is typing…" hint next to the participant.
  //
  // We deliberately broadcast regardless of visibilityMode now — the dots
  // are non-revealing (no content leaks) and the previous mode-gated check
  // silently dropped events for sessions created when the default was
  // "submitted" (or the now-removed "live"), which made the typing
  // indicator look broken even though everything else was wired up.
  if (req.method === "POST" && parts[3] === "typing") {
    if (caller.role === "viewer") return json({ ok: true })
    const body = (await req.json().catch(() => ({}))) as { typing?: boolean }
    const isTyping = Boolean(body.typing)
    const clientCount = sseClients.get(sessionId)?.size ?? 0
    console.log("[collab.typing]", {
      sessionId,
      login: sess.githubLogin,
      typing: isTyping,
      fanout: clientCount,
    })
    broadcastSse(sessionId, {
      type: isTyping ? "collab:typing_start" : "collab:typing_stop",
      githubLogin: sess.githubLogin,
    })
    return json({ ok: true })
  }

  // GET /collab/session/:id/notes — last 100 team notes, oldest-first.
  // Hydration on page reload + every collab:note_added SSE event appends.
  if (req.method === "GET" && parts[3] === "notes") {
    const notes = listRecentNotes(sessionId, 100)
    return new Response(JSON.stringify({ notes }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    })
  }

  // POST /collab/session/:id/note — side-channel team chat message.
  // Doesn't dispatch to opencode; just broadcasts the note + any
  // @-mentions to all participants.
  if (req.method === "POST" && parts[3] === "note") {
    if (caller.role === "viewer") {
      return json({ error: "Forbidden — Viewers cannot post notes" }, 403)
    }
    const body = (await req.json().catch(() => ({}))) as { content?: string }
    const content = typeof body.content === "string" ? body.content.trim() : ""
    if (!content) return json({ error: "Note content is empty" }, 400)
    if (content.length > 2000) return json({ error: "Note too long (max 2000 chars)" }, 400)

    const note = insertNote({
      collabSessionId: sessionId,
      authorGithubId: sess.githubId,
      authorGithubLogin: sess.githubLogin,
      content,
    })
    console.log("[collab.note]", {
      sessionId,
      noteId: note.id,
      authorLogin: sess.githubLogin,
      length: content.length,
    })

    broadcastSse(sessionId, { type: "collab:note_added", note })
    for (const event of mentionsToEvents({
      text: content,
      collabSession,
      authorLogin: sess.githubLogin,
      context: { kind: "note", noteId: note.id },
    })) {
      broadcastSse(sessionId, event)
    }
    return json({ note }, 201)
  }

  // POST /collab/session/:id/react/:sid — toggle an emoji reaction.
  // Body: { emoji: "🔥" }.  Re-posting the same emoji removes it.
  if (req.method === "POST" && parts[3] === "react" && parts[4]) {
    if (caller.role === "viewer") return json({ error: "Forbidden — Viewers cannot react" }, 403)
    const body = (await req.json().catch(() => ({}))) as { emoji?: string }
    const emoji = body.emoji
    if (!emoji || !isAllowedEmoji(emoji)) {
      return json({ error: "Invalid emoji" }, 400)
    }
    const { reactions } = toggleReaction(parts[4], sess.githubLogin, emoji)
    broadcastSse(sessionId, {
      type: "collab:reaction_changed",
      suggestionId: parts[4],
      reactions,
    })
    return json({ reactions })
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
    ensureQueueRegistered(sessionId)
    const winner = Queue.resolvePool(sessionId)
    if (!winner) return json({ error: "No pending suggestions" }, 404)
    broadcastSse(sessionId, { type: "collab:vote_winner", suggestionId: winner.id, content: winner.content })
    // Show the remaining pending pool (not the approved queue)
    broadcastSse(sessionId, { type: "collab:queue_update", queue: collabDb.getPendingPool(sessionId) })
    // LLM dispatch is handled by the queue executor — resolvePool → _scheduleNext → executor
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

  // GET /collab/session/:id/queue — current pending suggestions (for page reload recovery)
  if (req.method === "GET" && parts[3] === "queue") {
    ensureQueueRegistered(sessionId)
    return json(collabDb.getPendingPool(sessionId))
  }

  return json({ error: "Not found" }, 404)
}

// ── SSE stream handler ──────────────────────────────────────────────────────────

function handleSse(
  _req: Request,
  collabSessionId: string,
  sess: { githubId: number; githubLogin: string },
): Response {
  // We need to defer events until the ReadableStream's controller exists.
  // The bug we're fixing: previously, setOnline + the collab:participant_joined
  // broadcast ran here at the top of handleSse, which meant the new client's
  // own `send` callback wasn't registered yet (it gets registered inside
  // stream.start()).  So the connecting user never received their OWN
  // joined event and their own avatar stayed isOnline:false until something
  // else triggered a session re-fetch.
  //
  // Fix: queue events into a buffer up-front, register the send callback
  // immediately inside stream.start(), THEN flush the buffer + register
  // with the broadcaster.  The connecting client now sees its own
  // participant_joined event in the very first batch of SSE messages.
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  let unregister: (() => void) | null = null
  const encoder = new TextEncoder()
  const pending: CollabEvent[] = []

  const send = (event: CollabEvent) => {
    if (!controllerRef) {
      pending.push(event)
      return
    }
    try {
      const data = `data: ${JSON.stringify(event)}\n\n`
      controllerRef.enqueue(encoder.encode(data))
    } catch {
      unregister?.()
    }
  }

  // Mark the participant online + broadcast — now safe because the SENDER's
  // own `send` will buffer the event and flush it once the stream opens.
  const collabSession = Session.getCollabSession(collabSessionId)
  if (collabSession) {
    Participant.setOnline(collabSessionId, sess.githubId, true)
    const participant = collabSession.participants.find((p) => p.githubId === sess.githubId)
    if (participant) {
      const event: CollabEvent = {
        type: "collab:participant_joined",
        participant: { ...participant, isOnline: true },
      }
      // Send to ALL existing clients (so other browsers update).  The
      // sender's own send is wired into broadcasts below via registerSse,
      // so we also push directly into our pending buffer for this case
      // (broadcastSse fans out to currently-registered clients only).
      send(event)
      broadcastSse(collabSessionId, event)
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller
      // Flush any events that arrived before the stream was ready.
      for (const ev of pending) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
        } catch {
          break
        }
      }
      pending.length = 0
      // Send current queue state immediately.
      const current = Session.getCollabSession(collabSessionId)
      if (current) {
        ensureQueueRegistered(collabSessionId)
        send({ type: "collab:queue_update", queue: collabDb.getPendingPool(collabSessionId) })
      }
      unregister = registerSse(collabSessionId, send)
    },
    cancel() {
      unregister?.()
      Participant.setOnline(collabSessionId, sess.githubId, false)
      // Clear any lingering "is typing…" indicator from this user — if they
      // disconnect while typing, others would otherwise see the dot forever.
      broadcastSse(collabSessionId, { type: "collab:typing_stop", githubLogin: sess.githubLogin })
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
