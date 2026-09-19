#!/usr/bin/env bun
/** Read OpenCode sessions from an already-running local service. Does not start the server. */

const TIMEOUT_MS = 2_000
const STATS_TIMEOUT_MS = 4_000
const USERNAME = "opencode"
const GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const GO_CACHE_TTL_MS = 300_000

function stateDir() {
  const xdg = process.env.XDG_STATE_HOME
  return `${xdg || `${process.env.HOME}/.local/state`}/opencode`
}

function dataDir() {
  const xdg = process.env.XDG_DATA_HOME
  return `${xdg || `${process.env.HOME}/.local/share`}/opencode`
}

function cacheDir() {
  const xdg = process.env.XDG_CACHE_HOME
  return `${xdg || `${process.env.HOME}/.cache`}/omarchy`
}

function registrationPaths() {
  const directory = stateDir()
  return [`${directory}/service-v2.json`, `${directory}/service.json`]
}

async function readJson(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) return
  return file.json().catch(() => undefined)
}

function registration(payload: unknown) {
  if (!payload || typeof payload !== "object") return
  const url = String(Reflect.get(payload, "url") || "")
  const password = Reflect.get(payload, "password")
  if (!url.startsWith("http")) return
  if (typeof password !== "string" || password === "") return
  return { url: url.replace(/\/$/, ""), password }
}

async function request(
  service: { url: string; password: string },
  path: string,
  options?: { method?: string; timeout?: number },
) {
  const method = options?.method ?? "GET"
  const response = await fetch(new URL(path, `${service.url}/`), {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${USERNAME}:${service.password}`)}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(options?.timeout ?? TIMEOUT_MS),
    body: method === "GET" ? undefined : "",
  })
  if (response.status === 204) return { status: 204, body: undefined }
  return { status: response.status, body: await response.json().catch(() => undefined) }
}

async function probe(service: { url: string; password: string }) {
  for (const path of ["/api/info", "/api/status"]) {
    const result = await request(service, path).catch(() => undefined)
    if (!result) return
    if (result.status === 404) continue
    if (result.body && typeof result.body === "object") return service
    return
  }
}

function goApiKey(payload: unknown) {
  if (!payload || typeof payload !== "object") return
  for (const name of ["opencode-go", "opencode"]) {
    const entry = Reflect.get(payload, name)
    if (!entry || typeof entry !== "object") continue
    for (const field of ["key", "apiKey", "token"]) {
      const value = Reflect.get(entry, field)
      if (typeof value === "string" && value.startsWith("sk-")) return value
    }
  }
}

function goWindow(title: string, payload: unknown) {
  if (!payload || typeof payload !== "object") return
  const raw = Reflect.get(payload, "percent") ?? Reflect.get(payload, "usagePercent")
  const percent = Number(raw)
  if (!Number.isFinite(percent)) return
  const ratio = percent > 1 ? percent / 100 : percent
  const resets = Reflect.get(payload, "resetsAt") ?? Reflect.get(payload, "resetAt") ?? ""
  return {
    title,
    percent: Math.max(0, Math.min(1, ratio)),
    resetsAt: String(resets),
    status: String(Reflect.get(payload, "status") || ""),
  }
}

async function readGoCache() {
  const cached = await readJson(`${cacheDir()}/opencode-go-usage.json`)
  if (!cached || typeof cached !== "object") return
  const fetched = Number(Reflect.get(cached, "fetchedAt") || 0)
  if (!(fetched > 0) || Date.now() - fetched > GO_CACHE_TTL_MS) return
  const limits = Reflect.get(cached, "limits")
  if (!Array.isArray(limits)) return
  return { limits }
}

async function writeGoCache(limits: unknown[]) {
  const { mkdir } = await import("node:fs/promises")
  await mkdir(cacheDir(), { recursive: true })
  await Bun.write(`${cacheDir()}/opencode-go-usage.json`, JSON.stringify({ fetchedAt: Date.now(), limits }))
}

async function fetchGoQuota() {
  const cached = await readGoCache()
  if (cached) return cached
  const key = goApiKey(await readJson(`${dataDir()}/auth.json`))
  if (!key) return null
  const response = await fetch(GO_USAGE_URL, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined)
  if (!response?.ok) return null
  const payload = await response.json().catch(() => undefined)
  const usage = payload && typeof payload === "object" && "usage" in payload ? payload.usage : payload
  if (!usage || typeof usage !== "object") return null
  const windows = [
    ["5-hour", ["rolling", "rolling5h"]],
    ["Weekly", ["weekly"]],
    ["Monthly", ["monthly"]],
  ] as const
  const limits = windows.flatMap(([title, fields]) => {
    const field = fields.find((name) => name in usage)
    const window = goWindow(title, field ? Reflect.get(usage, field) : undefined)
    return window ? [window] : []
  })
  if (limits.length === 0) return null
  await writeGoCache(limits)
  return { limits }
}

async function localTimezone() {
  if (process.env.TZ) return process.env.TZ
  const { realpath } = await import("node:fs/promises")
  const resolved = await realpath("/etc/localtime").catch(() => "")
  const marker = "/zoneinfo/"
  const index = resolved.indexOf(marker)
  if (index < 0) return "UTC"
  return resolved.slice(index + marker.length)
}

async function fetchTodayStats(service: { url: string; password: string }) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const query = new URLSearchParams({
    from: String(start.getTime()),
    to: String(now.getTime() + 1),
    timezone: await localTimezone(),
    tools: "none",
  })
  const result = await request(service, `/api/experimental/session/stats?${query}`, {
    timeout: STATS_TIMEOUT_MS,
  }).catch(() => undefined)
  const body = result?.body
  if (!body || typeof body !== "object") return null
  const data = Reflect.get(body, "data")
  if (!data || typeof data !== "object") return null
  return data
}

async function activateSession(service: { url: string; password: string }, sessionID: string) {
  const result = await request(service, `/api/session/${encodeURIComponent(sessionID)}/activate`, { method: "POST" })
  if (result.status === 404) return { ok: true, activated: false }
  if (result.status < 200 || result.status >= 300) throw new Error("unreachable")
  const body = result.body
  if (!body || typeof body !== "object") return { ok: true, activated: false }
  return { ok: true, activated: Reflect.get(body, "outcome") === "activated" }
}

async function fetchSnapshot(service: { url: string; password: string }, limit: number) {
  const query = new URLSearchParams({ parentID: "null", limit: String(limit) })
  const sessions = await request(service, `/api/session?${query}`)
  const active = await request(service, "/api/session/active")
  const sessionBody = sessions.body
  const activeBody = active.body
  const sessionData =
    sessionBody && typeof sessionBody === "object" ? Reflect.get(sessionBody, "data") : undefined
  const activeData = activeBody && typeof activeBody === "object" ? Reflect.get(activeBody, "data") : undefined
  if (!Array.isArray(sessionData)) throw new Error("session list missing")
  return {
    ok: true,
    url: service.url,
    sessions: sessionData,
    active: activeData && typeof activeData === "object" ? activeData : {},
    go: await fetchGoQuota(),
    stats: await fetchTodayStats(service),
  }
}

async function firstLive() {
  for (const path of registrationPaths()) {
    const loaded = registration(await readJson(path))
    if (!loaded) continue
    const live = await probe(loaded)
    if (live) return live
  }
}

async function main() {
  const args = Bun.argv.slice(2)
  const activateID = args[0] === "activate" ? (args[1] ?? "") : ""
  if (args[0] === "activate" && activateID === "") {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "offline" })}\n`)
    return 0
  }
  const parsedLimit = args[0] === "activate" ? NaN : Number.parseInt(args[0] ?? "", 10)
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, parsedLimit)) : 20
  const live = await firstLive()
  if (!live) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "offline" })}\n`)
    return 0
  }
  const payload = await (activateID ? activateSession(live, activateID) : fetchSnapshot(live, limit)).catch(
    () => undefined,
  )
  if (!payload) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "unreachable" })}\n`)
    return 0
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
  return 0
}

process.exit(await main())
