export * as McpCooldown from "./cooldown.js"

import { createHash } from "node:crypto"
import { clearInterval, setInterval } from "node:timers"
import type { FetchLike } from "@modelcontextprotocol/client"

const FALLBACK_DELAY = 1_000n
const cooldowns = new Map<string, bigint>()
let cleanup: ReturnType<typeof setInterval> | undefined
const clock = () => BigInt(Math.floor(performance.now()))

/** Share cooldowns across connections to the configured endpoint. Never queue or replay requests. */
export function wrap(configured: URL, transport: URL, send: FetchLike): FetchLike {
  const endpoints = new Set([identity(configured), identity(transport)])
  const key = identity(configured)
  return async (url, init) => {
    // The SDK also uses this fetch for OAuth discovery and token requests. Only gate the MCP URLs.
    if (!endpoints.has(identity(new URL(url)))) return send(url, init)
    init?.signal?.throwIfAborted()
    const remaining = (cooldowns.get(key) ?? 0n) - clock()
    if (remaining > 0n)
      return new Response("MCP endpoint cooldown after HTTP 429", {
        status: 429,
        headers: { "retry-after": String((remaining + 999n) / 1_000n) },
      })
    cooldowns.delete(key)

    const response = await send(url, init)
    if (response.status !== 429) return response
    const now = clock()
    // Prune expired entries without letting a concurrent shorter limit shorten the cooldown.
    for (const [endpoint, until] of cooldowns) {
      if (until <= now) cooldowns.delete(endpoint)
    }
    const until = delay(response.headers.get("retry-after"), Date.now()) + BigInt(Math.ceil(performance.now()))
    if (until > (cooldowns.get(key) ?? 0n)) cooldowns.set(key, until)
    // Sweep even without traffic. Evicting active entries would shorten advertised delays.
    if (cleanup === undefined) {
      cleanup = setInterval(() => {
        const now = clock()
        for (const [endpoint, until] of cooldowns) {
          if (until <= now) cooldowns.delete(endpoint)
        }
        if (cooldowns.size !== 0) return
        clearInterval(cleanup)
        cleanup = undefined
      }, 1_000)
      cleanup.unref()
    }
    return response
  }
}

/** Retry-After accepts integer seconds or HTTP dates. Date.parse alone also accepts invalid values such as "1.5". */
export function delay(header: string | null, now: number): bigint {
  const value = header?.trim()
  if (!value) return FALLBACK_DELAY
  if (/^\d+$/.test(value)) return BigInt(value) * 1_000n
  const date = httpDate(value, now)
  return date === undefined ? FALLBACK_DELAY : BigInt(Math.max(0, date - now))
}

function httpDate(value: string, now: number): number | undefined {
  const standard = /^([A-Za-z]{3}), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value)
  const obsolete = /^([A-Za-z]+), (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value)
  const asctime = /^([A-Za-z]{3}) ([A-Za-z]{3}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(value)
  const parts =
    standard ??
    obsolete ??
    (asctime
      ? [asctime[0], asctime[1], asctime[3], asctime[2], asctime[7], asctime[4], asctime[5], asctime[6]]
      : undefined)
  if (!parts) return undefined
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].findIndex((day) =>
    obsolete ? day === parts[1] : day.slice(0, 3) === parts[1],
  )
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(
    parts[3] ?? "",
  )
  if (weekday < 0 || month < 0) return undefined
  const cutoff = new Date(now)
  const current = cutoff.getUTCFullYear()
  cutoff.setUTCFullYear(current + 50)
  const fullYear = obsolete ? Math.floor(current / 100) * 100 + Number(parts[4]) : Number(parts[4])
  const day = Number(parts[2])
  const hour = Number(parts[5])
  const minute = Number(parts[6])
  const second = Number(parts[7])
  const year =
    obsolete && Date.UTC(fullYear, month, day, hour, minute, second) > cutoff.getTime() ? fullYear - 100 : fullYear
  const date = new Date(0)
  date.setUTCFullYear(year, month, day)
  date.setUTCHours(hour, minute, second, 0)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCDay() !== weekday
  )
    return undefined
  return date.getTime()
}

function identity(input: URL): string {
  const url = new URL(input)
  url.username = ""
  url.password = ""
  url.hash = ""
  // The codemode=false opt-out does not change which endpoint is rate-limited.
  if (url.searchParams.get("codemode") === "false") url.searchParams.delete("codemode")
  url.search = url.searchParams.toString()
  // Queries can themselves carry credentials. Store only a digest and never report it in errors.
  return createHash("sha256").update(url.href).digest("hex")
}
