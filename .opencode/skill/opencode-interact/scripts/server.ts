import os from "os"
import path from "path"

export interface Target {
  url: string
  port: number
  kind: "desktop-sidecar" | "standalone" | "manual"
  source: "bridge-file" | "default-port" | "flag"
  username?: string
  password?: string
  bridgePath?: string
  appPid?: number
}

export interface PublicTarget {
  url: string
  port: number
  kind: Target["kind"]
  source: Target["source"]
  auth: boolean
  bridge_path?: string
  app_pid?: number
}

interface Bridge {
  app?: {
    pid?: number
  }
  server?: {
    url?: string
    username?: string | null
    password?: string | null
  }
  time?: number
}

export function base(port: number) {
  return `http://127.0.0.1:${port}`
}

function auth(target: Pick<Target, "username" | "password">) {
  if (!target.password) return
  return `Basic ${Buffer.from(`${target.username ?? "opencode"}:${target.password}`).toString("base64")}`
}

export async function req(target: Target, input: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  const value = auth(target)
  if (value && !headers.has("Authorization")) {
    headers.set("Authorization", value)
  }
  return fetch(`${target.url}${input}`, {
    ...init,
    headers,
  })
}

export async function json<T = any>(target: Target, input: string, init?: RequestInit): Promise<T> {
  const resp = await req(target, input, init)
  if (resp.status === 204) return undefined as T
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`)
  return resp.json() as Promise<T>
}

function bridgePaths() {
  const home = os.homedir()
  const file = "openclaw-bridge.json"
  const result = [] as string[]
  if (process.env.OPENCODE_DESKTOP_BRIDGE) {
    result.push(process.env.OPENCODE_DESKTOP_BRIDGE)
  }
  const ids = ["ai.opencode.desktop", "ai.opencode.desktop.beta", "ai.opencode.desktop.dev"]
  if (process.platform === "darwin") {
    result.push(...ids.map((id) => path.join(home, "Library", "Application Support", id, file)))
  }
  if (process.platform === "linux") {
    const root = process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
    result.push(...ids.map((id) => path.join(root, id, file)))
  }
  if (process.platform === "win32") {
    const root = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
    result.push(...ids.map((id) => path.join(root, id, file)))
  }
  return [...new Set(result)]
}

export async function desktop() {
  const found = [] as Array<Target & { time: number }>
  for (const file of bridgePaths()) {
    const handle = Bun.file(file)
    if (!(await handle.exists())) continue
    const data = (await handle.json()) as Bridge
    if (!data.server?.url) continue
    const url = data.server.url.replace(/\/$/, "")
    found.push({
      url,
      port: Number(new URL(url).port || 80),
      kind: "desktop-sidecar",
      source: "bridge-file",
      username: data.server.username ?? undefined,
      password: data.server.password ?? undefined,
      bridgePath: file,
      appPid: data.app?.pid,
      time: data.time ?? 0,
    })
  }
  return found.sort((a, b) => b.time - a.time)
}

export async function ping(target: Target, timeout = 1500) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeout)
  try {
    const resp = await req(target, "/session?limit=1", { signal: abort.signal })
    if (!resp.ok) return false
    await resp.text()
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function has(target: Target, sessionID: string, timeout = 1500) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeout)
  try {
    const resp = await req(target, `/session/${sessionID}/message`, { signal: abort.signal })
    if (resp.status === 404) return false
    if (!resp.ok) return false
    await resp.text()
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function pub(target: Target): PublicTarget {
  return {
    url: target.url,
    port: target.port,
    kind: target.kind,
    source: target.source,
    auth: Boolean(target.password),
    bridge_path: target.bridgePath,
    app_pid: target.appPid,
  }
}

export async function resolve(input: {
  port?: number
  username?: string
  password?: string
  preferDesktop?: boolean
  sessionID?: string
}) {
  if (input.port !== undefined) {
    return {
      url: base(input.port),
      port: input.port,
      kind: "manual",
      source: "flag",
      username: input.username,
      password: input.password,
    } satisfies Target
  }

  const pool: Target[] = [
    ...((input.preferDesktop ?? true) ? await desktop() : []),
    { url: base(4098), port: 4098, kind: "standalone", source: "default-port" },
  ]
  const uniq = [...new Map(pool.map((item) => [item.url, item])).values()]
  const ok = [] as Target[]
  for (const item of uniq) {
    if (await ping(item)) ok.push(item)
  }
  if (input.sessionID) {
    for (const item of ok) {
      if (await has(item, input.sessionID)) return item
    }
  }
  if (ok[0]) return ok[0]
  throw new Error(`No reachable OpenCode server found. Checked: ${uniq.map((item) => item.url).join(", ") || "(none)"}`)
}

export async function list(input: { preferDesktop?: boolean; sessionID?: string } = {}) {
  const pool: Target[] = [
    ...((input.preferDesktop ?? true) ? await desktop() : []),
    { url: base(4098), port: 4098, kind: "standalone", source: "default-port" },
  ]
  const uniq = [...new Map(pool.map((item) => [item.url, item])).values()]
  return Promise.all(
    uniq.map(async (item) => ({
      server: pub(item),
      reachable: await ping(item),
      has_session: input.sessionID ? await has(item, input.sessionID) : undefined,
    })),
  )
}
