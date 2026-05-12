import type http from "node:http"
import { config } from "./config.js"
import {
  type SessionKey,
  RemoteRefsUnreachableError,
  ensurePVC,
  ensurePod,
  getAttachUrl,
  getPodState,
  getSessionHash,
  getSessionInfo,
  getSessionProgress,
  listUserSessions,
  prepullImage,
  remoteBranchExists,
  terminateSession,
  resumeSession,
  suggestBranch,
} from "./pod-manager.js"
import { podSecretStore } from "./pod-secret-store.js"
import { messageStore } from "./message-store.js"
import { portStore } from "./port-store.js"
import { sessionsChangedBroadcaster, progressBroadcaster } from "./stream-broadcaster.js"
import { ProgressPushEventSchema, type StoredMessage } from "./progress-types.js"

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body))
}

function errorCode(err: unknown): string {
  if (err instanceof Error) return err.message
  return "Unknown"
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf-8")
}

/**
 * Handle API routes. Returns true if the route was handled.
 *
 * Routes:
 *   GET  /api/sessions          → list all sessions for the authenticated user
 *   POST /api/sessions          → create a session {repoUrl, branch} → {hash, url, state}
 *   GET  /api/sessions/:hash    → get state of a specific session
 */
export async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  email: string,
  githubToken?: string,
): Promise<boolean> {
  const url = req.url ?? "/"

  // GET /api/sessions/stream — SSE, emits full sessions snapshot when any session changes
  if (url === "/api/sessions/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    // Serialize concurrent snapshot fetches: if one is already in-flight,
    // set a flag so we re-run after it completes rather than interleave.
    let snapshotInFlight = false
    let pendingSnapshot = false

    const sendSnapshot = async () => {
      if (res.writableEnded) return
      if (snapshotInFlight) {
        pendingSnapshot = true
        return
      }
      snapshotInFlight = true
      try {
        const sessions = await listUserSessions(email, req)
        if (!res.writableEnded) res.write(`event: sessions\ndata: ${JSON.stringify({ email, sessions })}\n\n`)
      } catch (err) {
        console.error("sessions/stream: listUserSessions failed:", err)
        if (!res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: "Failed to list sessions" })}\n\n`)
          res.end()
        }
      } finally {
        snapshotInFlight = false
        if (pendingSnapshot && !res.writableEnded) {
          pendingSnapshot = false
          // Tail-call: flush the pending emit that arrived while we were in-flight
          sendSnapshot()
        }
      }
    }

    // Subscribe BEFORE the initial fetch so any emit that fires during the
    // initial k8s list call is not silently dropped (subscribe-after-emit race).
    const unsubscribe = sessionsChangedBroadcaster.subscribe(() => {
      if (res.writableEnded) {
        unsubscribe()
        return
      }
      sendSnapshot()
    })
    res.on("close", () => unsubscribe())
    await sendSnapshot()
    return true
  }

  // GET /api/sessions — list all sessions for this user, always includes email
  if (url === "/api/sessions" && req.method === "GET") {
    try {
      const sessions = await listUserSessions(email, req)
      json(res, 200, { email, sessions })
    } catch (err) {
      console.error("listUserSessions failed:", err)
      json(res, 500, { error: "Failed to list sessions" })
    }
    return true
  }

  // POST /api/sessions — create a new session
  if (url === "/api/sessions" && req.method === "POST") {
    const raw = await readBody(req)
    let repoUrl: string
    let branch: string
    let sourceBranch: string
    let initialMessage: string
    try {
      const body = JSON.parse(raw)
      repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : ""
      branch = typeof body.branch === "string" ? body.branch.trim() : ""
      sourceBranch = typeof body.sourceBranch === "string" ? body.sourceBranch.trim() : ""
      initialMessage = typeof body.initialMessage === "string" ? body.initialMessage.trim() : ""
    } catch {
      json(res, 400, { error: "Invalid JSON" })
      return true
    }

    if (!repoUrl) {
      json(res, 400, { error: "repoUrl is required" })
      return true
    }
    if (!branch) {
      json(res, 400, { error: "branch is required" })
      return true
    }
    if (!sourceBranch) {
      json(res, 400, { error: "sourceBranch is required" })
      return true
    }

    // Verify the source branch actually exists on the remote BEFORE creating PVC/pod.
    // Otherwise the pod's init container crashloops on `git checkout -B <sourceBranch> origin/<sourceBranch>`.
    try {
      const exists = await remoteBranchExists(repoUrl, sourceBranch)
      if (!exists) {
        json(res, 400, { error: `Branch "${sourceBranch}" not found on ${repoUrl}` })
        return true
      }
    } catch (err) {
      if (err instanceof RemoteRefsUnreachableError) {
        json(res, 502, { error: err.message })
        return true
      }
      throw err
    }

    const session: SessionKey = { email, repoUrl, branch, sourceBranch, initialMessage: initialMessage || undefined }
    const hash = getSessionHash(email, repoUrl, branch)

    await ensurePVC(session)
    await ensurePod(session, githubToken)
    sessionsChangedBroadcaster.emit()

    json(res, 201, { hash, url: null, state: "creating" })
    return true
  }

  // GET /api/sessions/suggest-branch — must be before /:hash regex
  if (url.startsWith("/api/sessions/suggest-branch") && req.method === "GET") {
    const query = new URLSearchParams(url.split("?")[1] ?? "")
    const repoUrl = query.get("repoUrl")
    if (!repoUrl) {
      json(res, 400, { error: "repoUrl is required" })
      return true
    }
    const branch = await suggestBranch(email, repoUrl)
    json(res, 200, { branch })
    return true
  }

  // GET /api/sessions/:hash/progress/stream — SSE, emits message thread for a session
  const progressStreamMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/progress\/stream$/)
  if (progressStreamMatch && req.method === "GET") {
    const hash = progressStreamMatch[1]
    // Ownership check
    const userSessions = await listUserSessions(email, req)
    if (!userSessions.find((s) => s.hash === hash)) {
      json(res, 403, { error: "Forbidden" })
      return true
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    // Subscribe BEFORE writing the snapshot so any progressBroadcaster.emit()
    // that arrives during snapshot serialisation is not silently dropped.
    // Symmetric with the subscribe-before-fetch fix in /api/sessions/stream.
    // The snapshot itself already includes any message stored before this
    // moment, so the listener safely deduplicates by partID on the client.
    const unsubscribe = progressBroadcaster.subscribe(({ hash: h, message }) => {
      if (res.writableEnded || h !== hash) return
      res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`)
    })
    res.on("close", () => unsubscribe())
    const progress = messageStore.get(hash) ?? { messages: [] }
    res.write(`event: snapshot\ndata: ${JSON.stringify(progress)}\n\n`)
    return true
  }

  // GET /api/sessions/:hash/events — SSE endpoint for session startup progress
  //
  // Streams session startup state as Server-Sent Events. Events emitted:
  //   progress     { stage, message }  — human-readable startup stage update
  //   state_change { state }           — when pod state transitions (creating → running)
  //   complete     { url }             — session ready; frontend should navigate to url
  //   error        { message }         — unrecoverable error; connection closes after
  //
  // Connection closes automatically after `complete` or `error`.
  // Client disconnect is handled via res.on("close").
  const eventsMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/events$/)
  if (eventsMatch && req.method === "GET") {
    const hash = eventsMatch[1]

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })

    /**
     * Write a named SSE event with JSON data.
     * Returns false if the connection is already closed (caller should stop polling).
     */
    const sendEvent = (event: string, data: object): boolean => {
      if (res.writableEnded) return false
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      return true
    }

    const finish = (event: string, data: object) => {
      if (res.writableEnded) return
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      res.end()
    }

    // Check session exists before starting the poll loop
    const initial = await getSessionInfo(hash)
    if (!initial) {
      finish("error", { message: "session not found" })
      return true
    }

    let lastState = initial.state
    let lastStage = ""
    // Limit how long we wait for a running pod to resolve its deep link URL.
    // Each poll is 1 s; 30 polls = 30 s max after the pod becomes running.
    let runningPollCount = initial.state === "running" ? 1 : 0
    const MAX_RUNNING_POLLS = 30

    // Send initial progress immediately
    const progress = await getSessionProgress(hash)
    lastStage = progress.stage
    if (!sendEvent("progress", progress)) return true
    if (lastState !== "creating") {
      if (!sendEvent("state_change", { state: lastState })) return true
    }

    // If already running on first check, try to resolve URL immediately
    if (initial.state === "running") {
      if (!sendEvent("progress", { stage: "readying", message: "Finalizing session..." })) return true
      if (initial.url !== null) {
        finish("complete", { url: initial.url })
        return true
      }
      // URL not yet resolved — fall through to the polling loop
    }

    // Poll every 1000ms for state/progress changes.
    // Uses recursive setTimeout (not setInterval) so each async tick fully
    // completes before the next one is scheduled — eliminates write-after-end races.
    const poll = async () => {
      if (res.writableEnded) return
      try {
        const info = await getSessionInfo(hash)

        // Re-check after await — client may have disconnected while we awaited k8s
        if (res.writableEnded) return

        if (!info) {
          finish("error", { message: "session not found" })
          return
        }

        // Emit state_change if state transitioned
        if (info.state !== lastState) {
          lastState = info.state
          if (!sendEvent("state_change", { state: info.state })) return
        }

        // Emit progress if stage changed (only while still creating)
        if (info.state === "creating") {
          const prog = await getSessionProgress(hash)
          if (res.writableEnded) return
          if (prog.stage !== lastStage) {
            lastStage = prog.stage
            if (!sendEvent("progress", prog)) return
          }
          setTimeout(poll, 1000)
          return
        }

        // Pod is running — wait for URL to be resolved (bootstrap in-flight returns null)
        if (info.state === "running") {
          if (lastStage !== "readying") {
            lastStage = "readying"
            if (!sendEvent("progress", { stage: "readying", message: "Finalizing session..." })) return
          }
          runningPollCount++
          if (info.url !== null) {
            finish("complete", { url: info.url })
            return
          }
          if (runningPollCount >= MAX_RUNNING_POLLS) {
            finish("error", { message: "session URL could not be resolved" })
            return
          }
        }
      } catch {
        // Transient k8s error — retry on next tick
      }
      setTimeout(poll, 1000)
    }
    setTimeout(poll, 1000)

    return true
  }

  // GET /api/sessions/:hash — get state of a specific session
  const sessionMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})$/)
  if (sessionMatch && req.method === "GET") {
    const hash = sessionMatch[1]
    const sessions = await listUserSessions(email, req)
    const session = sessions.find((s) => s.hash === hash)
    if (session) {
      json(res, 200, session)
      return true
    }
    // Fallback: not owned by this user but hash exists — no deep link available
    const state = await getPodState(hash)
    json(res, 200, {
      hash,
      state,
      url: null,
      lastActivity: new Date().toISOString(),
      idleTimeoutMinutes: config.idleTimeoutMinutes,
    })
    return true
  }

  // GET /api/sessions/:hash/attach-info — get attach URL and password for session owner
  const attachInfoMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/attach-info$/)
  if (attachInfoMatch && req.method === "GET") {
    const hash = attachInfoMatch[1]
    const sessionInfo = await getSessionInfo(hash)
    if (!sessionInfo) {
      json(res, 404, { error: "Session not found" })
      return true
    }
    // Only return attach info if the requesting user owns the session
    if (sessionInfo.email !== email) {
      json(res, 403, { error: "Forbidden" })
      return true
    }
    json(res, 200, {
      hash,
      attachUrl: sessionInfo.attachUrl,
      attachPassword: sessionInfo.attachPassword,
    })
    return true
  }

  // POST /api/sessions/:hash/resume
  const resumeMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/resume$/)
  if (resumeMatch && req.method === "POST") {
    const hash = resumeMatch[1]
    try {
      await resumeSession(hash, email, githubToken)
    } catch (err) {
      const code = errorCode(err)
      if (code === "Forbidden") {
        json(res, 403, { error: "Forbidden" })
        return true
      }
      if (code === "NotFound") {
        json(res, 404, { error: "Not found" })
        return true
      }
      throw err
    }
    json(res, 200, { hash, state: "creating", url: null })
    return true
  }

  // DELETE /api/sessions/:hash
  const deleteMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})$/)
  if (deleteMatch && req.method === "DELETE") {
    const hash = deleteMatch[1]
    try {
      await terminateSession(hash, email)
    } catch (err) {
      const code = errorCode(err)
      if (code === "Forbidden") {
        json(res, 403, { error: "Forbidden" })
        return true
      }
      if (code === "NotFound") {
        json(res, 404, { error: "Not found" })
        return true
      }
      throw err
    }
    json(res, 204, null)
    return true
  }

  // GET /api/user/repos — list repositories for authenticated user via GitHub API
  if (url === "/api/user/repos" && req.method === "GET") {
    if (!githubToken) {
      json(res, 401, { error: "GitHub token required" })
      return true
    }
    try {
      const reposRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "opencode-router",
        },
      })
      if (!reposRes.ok) {
        const err = await reposRes.text()
        json(res, reposRes.status, { error: err })
        return true
      }
      const repos = (await reposRes.json()) as {
        name: string
        full_name: string
        html_url: string
        private: boolean
        default_branch: string
      }[]
      json(
        res,
        200,
        repos.map((r) => ({
          name: r.name,
          fullName: r.full_name,
          url: r.html_url,
          isPrivate: r.private,
          defaultBranch: r.default_branch,
        })),
      )
    } catch (err) {
      console.error("listUserRepos failed:", err)
      json(res, 500, { error: "Failed to list repos" })
    }
    return true
  }

  // GET /api/user/repos/branches — list branches for a specific repo
  if (url.startsWith("/api/user/repos/branches") && req.method === "GET") {
    if (!githubToken) {
      json(res, 401, { error: "GitHub token required" })
      return true
    }
    const query = new URLSearchParams(url.split("?")[1] ?? "")
    const repo = query.get("repo")
    if (!repo) {
      json(res, 400, { error: "repo parameter required" })
      return true
    }
    try {
      const branchesRes = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "opencode-router",
        },
      })
      if (!branchesRes.ok) {
        const err = await branchesRes.text()
        json(res, branchesRes.status, { error: err })
        return true
      }
      const branches = (await branchesRes.json()) as { name: string }[]
      json(
        res,
        200,
        branches.map((b) => ({ name: b.name })),
      )
    } catch (err) {
      console.error("listRepoBranches failed:", err)
      json(res, 500, { error: "Failed to list branches" })
    }
    return true
  }

  // POST /api/admin/pull-image — pre-pull container image (CI endpoint)
  if (url === "/api/admin/pull-image" && req.method === "POST") {
    // Check if admin endpoint is configured
    if (!config.adminSecret) {
      json(res, 501, { error: "Admin endpoint not configured" })
      return true
    }

    // Verify admin secret
    const providedSecret = req.headers["x-admin-secret"]
    if (providedSecret !== config.adminSecret) {
      json(res, 403, { error: "Forbidden" })
      return true
    }

    const raw = await readBody(req)
    let image: string
    let updateConfig = false
    try {
      const body = JSON.parse(raw)
      image = typeof body.image === "string" ? body.image.trim() : ""
      updateConfig = typeof body.updateConfig === "boolean" ? body.updateConfig : false
    } catch {
      json(res, 400, { error: "Invalid JSON" })
      return true
    }

    if (!image) {
      json(res, 400, { error: "image is required" })
      return true
    }

    try {
      const success = await prepullImage(image)

      if (success && updateConfig) {
        // Note: This only updates in-memory config for this process.
        // For persistence across restarts, update the deployment env var.
        ;(config as Record<string, unknown>).opencodeImage = image
      }

      if (success) {
        json(res, 200, {
          status: "success",
          message: `Image ${image} pre-pulled and verified successfully`,
        })
      } else {
        json(res, 500, {
          status: "failed",
          message: `Failed to pull and verify image ${image}`,
        })
      }
    } catch (err) {
      console.error("prepullImage failed:", err)
      json(res, 500, { error: "Internal server error" })
    }

    return true
  }

  // POST /api/sessions/:hash/progress — pod plugin pushes session data
  const progressPushMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/progress$/)
  if (progressPushMatch && req.method === "POST") {
    const hash = progressPushMatch[1]
    const podSecret = req.headers["x-pod-secret"]
    if (typeof podSecret !== "string" || !podSecretStore.verify(hash, podSecret)) {
      json(res, 401, { error: "Unauthorized" })
      return true
    }
    const raw = await readBody(req)
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      json(res, 400, { error: "Invalid JSON" })
      return true
    }
    const parsed = ProgressPushEventSchema.safeParse(parsedJson)
    if (!parsed.success) {
      json(res, 400, { error: "Invalid event payload" })
      return true
    }
    const event = parsed.data
    if (event.type === "session.title") {
      messageStore.setTitle(hash, event.title)
      sessionsChangedBroadcaster.emit()
    } else if (event.type === "message.user") {
      messageStore.addMessage(hash, {
        partID: event.partID,
        messageID: event.messageID,
        sessionID: event.sessionID,
        role: "user",
        text: event.text,
        time: event.time,
      })
      sessionsChangedBroadcaster.emit()
      progressBroadcaster.emit({
        hash,
        message: {
          partID: event.partID,
          messageID: event.messageID,
          sessionID: event.sessionID,
          role: "user",
          text: event.text,
          time: event.time,
        },
      })
    } else {
      messageStore.addMessage(hash, {
        partID: event.partID,
        messageID: event.messageID,
        sessionID: event.sessionID,
        role: "assistant",
        text: event.text,
        time: event.time,
      })
      sessionsChangedBroadcaster.emit()
      progressBroadcaster.emit({
        hash,
        message: {
          partID: event.partID,
          messageID: event.messageID,
          sessionID: event.sessionID,
          role: "assistant",
          text: event.text,
          time: event.time,
        },
      })
    }
    json(res, 200, { ok: true })
    return true
  }

  // POST /api/sessions/:hash/ports — pod pushes list of listening dev-server ports
  const portsPushMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/ports$/)
  if (portsPushMatch && req.method === "POST") {
    const hash = portsPushMatch[1]
    const podSecret = req.headers["x-pod-secret"]
    if (typeof podSecret !== "string" || !podSecretStore.verify(hash, podSecret)) {
      json(res, 401, { error: "Unauthorized" })
      return true
    }
    const raw = await readBody(req)
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      json(res, 400, { error: "Invalid JSON" })
      return true
    }
    if (!parsedJson || typeof parsedJson !== "object" || !Array.isArray((parsedJson as { ports?: unknown }).ports)) {
      json(res, 400, { error: "ports array required" })
      return true
    }
    const rawPorts = (parsedJson as { ports: unknown[] }).ports
    const validPorts = new Set(
      rawPorts.filter(
        (p): p is number => typeof p === "number" && Number.isInteger(p) && p > 3000 && p !== 4096 && p <= 65535,
      ),
    )
    portStore.set(hash, validPorts)
    json(res, 200, { ok: true })
    return true
  }

  // GET /api/sessions/:hash/ports — operator polls for reported dev-server ports (admin-secret gated in index.ts)
  const portsGetMatch = url.match(/^\/api\/sessions\/([a-f0-9]{12})\/ports$/)
  if (portsGetMatch && req.method === "GET") {
    const hash = portsGetMatch[1]
    json(res, 200, { ports: portStore.get(hash) })
    return true
  }

  return false
}
