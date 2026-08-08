/**
 * GitHub connector handlers — server-side device-flow proxy.
 *
 * Mirrors the desktop main-process implementation (packages/desktop/src/main/
 * connectors.ts) so the web app can connect GitHub through the Jarvis server
 * without hitting GitHub's CORS-restricted device endpoints.
 *
 * The access token is stored via the server Credential store (SQLite), keyed
 * by integration "github", and is never returned to the browser.
 *
 * Security note: unlike the desktop build (Electron safeStorage), the token is
 * stored as-is in the server SQLite Credential table. This matches how AI
 * provider OAuth credentials are stored in this codebase; encrypting at rest
 * would require a server-side secret and is out of scope for the web proxy.
 */

import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { InstanceHttpApi } from "../api"
import {
  ConnectorApiError,
  DeviceFlowStart,
  GitHubConnectorStatus,
  GitHubUser,
} from "../groups/connector"

const GITHUB_CLIENT_ID = "Ov23lifxOge1pqQvTnyB"
const GITHUB_SCOPES = "repo,user"
const GITHUB_API = "https://api.github.com"
// Device-flow endpoints (RFC 8628). These do NOT allow CORS, which is why the
// flow must run server-side instead of in the browser.
const DEVICE_CODE_URL = "https://github.com/login/device/code"
const TOKEN_URL = "https://github.com/login/oauth/access_token"
const INTEGRATION_ID = "github" as Integration.ID

type DeviceSession = {
  device_code: string
  interval: number
  expires_at: number
}

/** In-memory device-flow attempts keyed by opaque session id. */
const deviceSessions = new Map<string, DeviceSession>()

// Server processes are long-lived, so prune expired sessions opportunistically
// (on each device/poll call) instead of leaking abandoned attempts forever.
function pruneExpiredSessions() {
  const now = Date.now()
  for (const [id, session] of deviceSessions) {
    if (now > session.expires_at) deviceSessions.delete(id)
  }
}

const ghJsonHeaders = (token?: string): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
  })
  if (!res.ok) throw new Error(`GitHub endpoint error: ${res.status} ${res.statusText}`)
  return (await res.json()) as Record<string, unknown>
}

async function fetchUser(token: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: ghJsonHeaders(token) })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { login: string; avatar_url: string; name?: string }
  return { login: data.login, avatar: data.avatar_url, name: data.name }
}

export const connectorHandlers = HttpApiBuilder.group(InstanceHttpApi, "connector", (handlers) =>
  Effect.gen(function* () {
    const credential = yield* Credential.Service

    const toStatus = (stored: Credential.Info | undefined, enabled: boolean): GitHubConnectorStatus => {
      if (!stored || stored.value.type !== "key") return { enabled, connected: false }
      const metadata = stored.value.metadata ?? {}
      const user = metadata.user as GitHubUser | undefined
      return { enabled, connected: true, user }
    }

    const githubStatus = Effect.fn("ConnectorHttpApi.githubStatus")(function* () {
      const current = yield* credential.list(INTEGRATION_ID)
      const stored = current[0]
      return toStatus(stored, stored?.value.type === "key" && stored.value.metadata?.enabled === true)
    })

    const setEnabled = Effect.fn("ConnectorHttpApi.githubSetEnabled")(function* (ctx: {
      payload: { enabled: boolean }
    }) {
      const current = yield* credential.list(INTEGRATION_ID)
      const existing = current[0]
      if (!existing || existing.value.type !== "key") return { enabled: ctx.payload.enabled, connected: false }
      yield* credential.update(existing.id, {
        value: {
          ...existing.value,
          metadata: { ...(existing.value.metadata ?? {}), enabled: ctx.payload.enabled },
        },
      })
      return { enabled: ctx.payload.enabled, connected: true, user: existing.value.metadata?.user as GitHubUser | undefined }
    })

    const device = Effect.fn("ConnectorHttpApi.githubDevice")(function* () {
      pruneExpiredSessions()
      const data = yield* Effect.tryPromise({
        try: () => postForm(DEVICE_CODE_URL, { client_id: GITHUB_CLIENT_ID, scope: GITHUB_SCOPES }),
        catch: (error) => new ConnectorApiError({ name: "BadRequest", data: { message: errorMessage(error) } }),
      })

      const device_code = String(data.device_code ?? "")
      const user_code = String(data.user_code ?? "")
      const verification_uri = String(data.verification_uri ?? "https://github.com/login/device")
      const interval = Number(data.interval ?? 5)
      const expires_in = Number(data.expires_in ?? 900)

      if (!device_code || !user_code) {
        return yield* Effect.fail(
          new ConnectorApiError({ name: "BadRequest", data: { message: `GitHub device flow failed: ${JSON.stringify(data)}` } }),
        )
      }

      const sessionId = randomUUID()
      deviceSessions.set(sessionId, {
        device_code,
        interval,
        expires_at: Date.now() + expires_in * 1000,
      })

      return { sessionId, userCode: user_code, verificationUri: verification_uri, interval, expiresIn: expires_in } satisfies DeviceFlowStart
    })

    const poll = Effect.fn("ConnectorHttpApi.githubPoll")(function* (ctx: {
      payload: { sessionId: string }
    }) {
      pruneExpiredSessions()
      const session = deviceSessions.get(ctx.payload.sessionId)
      if (!session) return { status: "error", message: "Session not found or already finished" } as const
      if (Date.now() > session.expires_at) {
        deviceSessions.delete(ctx.payload.sessionId)
        return { status: "expired" } as const
      }

      const data = yield* Effect.tryPromise({
        try: () =>
          postForm(TOKEN_URL, {
            client_id: GITHUB_CLIENT_ID,
            device_code: session.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        catch: (error) => new ConnectorApiError({ name: "BadRequest", data: { message: errorMessage(error) } }),
      })

      const error = data.error
      if (error === "authorization_pending") return { status: "pending" } as const
      if (error === "slow_down") return { status: "pending", slowDown: true } as const
      if (error === "expired_token") {
        deviceSessions.delete(ctx.payload.sessionId)
        return { status: "expired" } as const
      }
      if (error === "access_denied") {
        deviceSessions.delete(ctx.payload.sessionId)
        return { status: "denied" } as const
      }
      if (error) {
        deviceSessions.delete(ctx.payload.sessionId)
        return { status: "error", message: String(data.error_description ?? error) } as const
      }

      const accessToken = String(data.access_token ?? "")
      if (!accessToken) return { status: "error", message: "No access_token in response" } as const

      deviceSessions.delete(ctx.payload.sessionId)

      const user = yield* Effect.tryPromise({
        try: () => fetchUser(accessToken),
        catch: (error) => new ConnectorApiError({ name: "BadRequest", data: { message: errorMessage(error) } }),
      })

      yield* credential.create({
        integrationID: INTEGRATION_ID,
        value: { type: "key", key: accessToken, metadata: { enabled: true, user } },
      })

      return { status: "success", user } as const
    })

    const disconnect = Effect.fn("ConnectorHttpApi.githubDisconnect")(function* () {
      const current = yield* credential.list(INTEGRATION_ID)
      for (const entry of current) yield* credential.remove(entry.id)
      return { enabled: false, connected: false }
    })

    return handlers
      .handle("status", githubStatus)
      .handle("setEnabled", setEnabled)
      .handle("device", device)
      .handle("poll", poll)
      .handle("disconnect", disconnect)
  }),
)

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : String(error)
}
