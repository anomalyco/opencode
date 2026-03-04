import { dialog } from "electron"

import { getConfig, serve, type CommandChild, type Config } from "./cli"
import { DEFAULT_SERVER_URL_KEY, WSL_ENABLED_KEY } from "./constants"
import { store } from "./store"

export type WslConfig = { enabled: boolean }

export type HealthCheck = { wait: Promise<void> }

export function getDefaultServerUrl(): string | null {
  const value = store.get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    store.set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  store.delete(DEFAULT_SERVER_URL_KEY)
}

export function getWslConfig(): WslConfig {
  const value = store.get(WSL_ENABLED_KEY)
  return { enabled: typeof value === "boolean" ? value : false }
}

export function setWslConfig(config: WslConfig) {
  store.set(WSL_ENABLED_KEY, config.enabled)
}

export async function getSavedServerUrl(): Promise<string | null> {
  const direct = getDefaultServerUrl()
  if (direct) return direct

  const config = await getConfig().catch(() => null)
  if (!config) return null
  return getServerUrlFromConfig(config)
}

export function spawnLocalServer(hostname: string, port: number, password: string) {
  const { child, exit, events } = serve(hostname, port, password)

  const wait = (async () => {
    const url = `http://${hostname}:${port}`

    const ready = async () => {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (await checkHealth(url, password)) return
      }
    }

    const terminated = async () => {
      const payload = await exit
      throw new Error(
        `Sidecar terminated before becoming healthy (code=${payload.code ?? "unknown"} signal=${
          payload.signal ?? "unknown"
        })`,
      )
    }

    await Promise.race([ready(), terminated()])
  })()

  return { child, health: { wait }, events }
}

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrl: URL
  try {
    healthUrl = new URL("/global/health", url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function checkHealthOrAskRetry(url: string): Promise<boolean> {
  while (true) {
    if (await checkHealth(url)) return true

    const result = await dialog.showMessageBox({
      type: "warning",
      message: `Could not connect to configured server:\n${url}\n\nWould you like to retry or start a local server instead?`,
      title: "Connection Failed",
      buttons: ["Retry", "Start Local"],
      defaultId: 0,
      cancelId: 1,
    })

    if (result.response === 0) continue
    return false
  }
}

export function normalizeHostnameForUrl(hostname: string) {
  if (hostname === "0.0.0.0") return "127.0.0.1"
  if (hostname === "::") return "[::1]"
  if (hostname.includes(":") && !hostname.startsWith("[")) return `[${hostname}]`
  return hostname
}

export function getServerUrlFromConfig(config: Config) {
  const server = config.server
  if (!server?.port) return null
  const host = server.hostname ? normalizeHostnameForUrl(server.hostname) : "127.0.0.1"
  return `http://${host}:${server.port}`
}

export type { CommandChild }
