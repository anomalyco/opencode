import { Log } from "../util/log"

const log = Log.create({ service: "auth.keepalive" })

const KEEPALIVE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

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

  return provider.records.filter((r: OAuthRecord) => r.access && r.namespace === "default")
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
      // Consume response body to complete the request
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

async function pingAllAnthropicAccounts(): Promise<void> {
  const records = await loadAnthropicRecords()
  if (records.length === 0) {
    log.info("no anthropic oauth accounts to ping")
    return
  }

  log.info("pinging anthropic oauth accounts", { count: records.length })

  for (const record of records) {
    const success = await pingWithMessagesAPI(record)
    if (success) {
      log.info("keepalive ping successful", {
        recordId: record.id,
        label: record.label,
      })
    }
  }
}

export function init(): void {
  if (interval) return

  log.info("starting oauth keepalive", { intervalMs: KEEPALIVE_INTERVAL_MS })

  // Initial ping after 1 minute (to let everything settle)
  setTimeout(() => {
    pingAllAnthropicAccounts().catch((err) => {
      log.error("keepalive ping error", { error: String(err) })
    })
  }, 60 * 1000)

  // Then every hour
  interval = setInterval(() => {
    pingAllAnthropicAccounts().catch((err) => {
      log.error("keepalive ping error", { error: String(err) })
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
