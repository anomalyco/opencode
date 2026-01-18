import { Log } from "../util/log"

const log = Log.create({ service: "auth.keepalive" })

const KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes (more frequent to catch expiring tokens)
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000 // Refresh 10 minutes before expiry

let interval: ReturnType<typeof setInterval> | undefined

interface OAuthRecord {
  id: string
  namespace: string
  label?: string
  access: string
  refresh: string
  expires: number
}

async function loadAnthropicRecords(): Promise<OAuthRecord[]> {
  const { Auth } = await import("./index")
  const store = await Auth.all()
  if (!store["anthropic"] || store["anthropic"].type !== "oauth") return []

  const path = await import("path")
  const { Global } = await import("../global")
  const fs = await import("fs/promises")

  const filepath = path.join(Global.Path.data, "auth.json")
  const raw = await fs.readFile(filepath, "utf-8").catch(() => null)
  if (!raw) return []

  const data = JSON.parse(raw)
  const provider = data.providers?.["anthropic"]
  if (!provider || provider.type !== "oauth") return []

  return provider.records.filter((r: OAuthRecord) => r.access && r.refresh && r.namespace === "default")
}

async function refreshAnthropicToken(record: OAuthRecord): Promise<{ access: string; expires: number } | null> {
  try {
    log.info("refreshing anthropic token", { recordId: record.id, label: record.label })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: record.refresh,
        client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      }).toString(),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      log.error("token refresh failed", {
        recordId: record.id,
        status: response.status,
        body: text.slice(0, 200),
      })
      return null
    }

    const data = (await response.json()) as {
      access_token: string
      expires_in?: number
      refresh_token?: string
    }

    log.info("token refresh successful", { recordId: record.id })

    return {
      access: data.access_token,
      expires: Date.now() + (data.expires_in ?? 3600) * 1000,
    }
  } catch (err) {
    log.error("token refresh error", {
      recordId: record.id,
      error: String(err),
    })
    return null
  }
}

async function updateStoredToken(recordId: string, access: string, expires: number): Promise<void> {
  const path = await import("path")
  const { Global } = await import("../global")
  const fs = await import("fs/promises")

  const filepath = path.join(Global.Path.data, "auth.json")
  const raw = await fs.readFile(filepath, "utf-8").catch(() => null)
  if (!raw) return

  const data = JSON.parse(raw)
  const provider = data.providers?.["anthropic"]
  if (!provider || provider.type !== "oauth") return

  const record = provider.records.find((r: OAuthRecord) => r.id === recordId)
  if (!record) return

  record.access = access
  record.expires = expires
  record.updatedAt = Date.now()

  await fs.writeFile(filepath, JSON.stringify(data, null, 2))
  log.info("updated stored token", { recordId })
}

async function pingWithMessagesAPI(record: OAuthRecord): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${record.access}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      await response.json().catch(() => {})
      return true
    }

    log.warn("keepalive ping failed", {
      recordId: record.id,
      label: record.label,
      status: response.status,
    })
    return false
  } catch (err) {
    log.warn("keepalive ping error", {
      recordId: record.id,
      label: record.label,
      error: String(err),
    })
    return false
  }
}

async function keepAliveAccount(record: OAuthRecord): Promise<void> {
  const now = Date.now()
  const expiresIn = record.expires - now

  // If token is expired or about to expire, refresh it first
  if (expiresIn < TOKEN_REFRESH_BUFFER_MS) {
    log.info("token expired or expiring soon, refreshing", {
      recordId: record.id,
      expiresIn: Math.round(expiresIn / 1000),
    })

    const newToken = await refreshAnthropicToken(record)
    if (newToken) {
      await updateStoredToken(record.id, newToken.access, newToken.expires)
      record.access = newToken.access
      record.expires = newToken.expires
    } else {
      log.error("failed to refresh token, skipping ping", { recordId: record.id })
      return
    }
  }

  // Now ping with the (potentially refreshed) token
  const success = await pingWithMessagesAPI(record)
  if (success) {
    log.info("keepalive ping successful", {
      recordId: record.id,
      label: record.label,
    })
  }
}

async function pingAllAnthropicAccounts(): Promise<void> {
  const records = await loadAnthropicRecords()
  if (records.length === 0) {
    log.info("no anthropic oauth accounts to ping")
    return
  }

  log.info("processing anthropic oauth accounts", { count: records.length })

  for (const record of records) {
    await keepAliveAccount(record)
  }
}

export function init(): void {
  if (interval) return

  log.info("starting oauth keepalive", { intervalMs: KEEPALIVE_INTERVAL_MS })

  // Initial check after 30 seconds
  setTimeout(() => {
    pingAllAnthropicAccounts().catch((err) => {
      log.error("keepalive error", { error: String(err) })
    })
  }, 30 * 1000)

  // Then every 30 minutes
  interval = setInterval(() => {
    pingAllAnthropicAccounts().catch((err) => {
      log.error("keepalive error", { error: String(err) })
    })
  }, KEEPALIVE_INTERVAL_MS)

  interval.unref()
}

export function stop(): void {
  if (interval) {
    clearInterval(interval)
    interval = undefined
    log.info("stopped oauth keepalive")
  }
}

export const AuthKeepAlive = {
  init,
  stop,
  ping: pingAllAnthropicAccounts,
}
