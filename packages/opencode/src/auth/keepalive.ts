import { Log } from "../util/log"
import { Auth } from "./index"

const log = Log.create({ service: "auth.keepalive" })

const KEEPALIVE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let interval: ReturnType<typeof setInterval> | undefined

async function pingAllAnthropicAccounts(): Promise<void> {
  const store = await Auth.all()
  const anthropic = store["anthropic"]
  if (!anthropic || anthropic.type !== "oauth") return

  const records = await Auth.OAuthPool.list("anthropic", "default")
  if (records.length === 0) return

  log.info("pinging anthropic oauth accounts", { count: records.length })

  for (const record of records) {
    const usage = await Auth.OAuthPool.fetchAnthropicUsage("anthropic", "default", record.id)
    if (usage) {
      log.info("keepalive ping successful", {
        recordId: record.id,
        label: record.label,
        fiveHourUsage: usage.fiveHour?.utilization,
      })
    } else {
      log.warn("keepalive ping failed", {
        recordId: record.id,
        label: record.label,
      })
    }
  }
}

export function init(): void {
  if (interval) return

  log.info("starting oauth keepalive", { intervalMs: KEEPALIVE_INTERVAL_MS })

  // Initial ping after 5 minutes (to let everything settle)
  setTimeout(
    () => {
      pingAllAnthropicAccounts().catch((err) => {
        log.error("keepalive ping error", { error: err })
      })
    },
    5 * 60 * 1000,
  )

  // Then every hour
  interval = setInterval(() => {
    pingAllAnthropicAccounts().catch((err) => {
      log.error("keepalive ping error", { error: err })
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
