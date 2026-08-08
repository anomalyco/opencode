/**
 * Server-backed GitHub connector transport for the web build.
 *
 * The desktop build talks to the GitHub connector through the platform bridge
 * (`platform.connector.github`), which proxies to the Electron main process.
 * The web build has no platform bridge, so it talks to the Jarvis server
 * connector endpoints instead — the server runs the device flow (GitHub's
 * device endpoints don't allow CORS) and stores the token server-side.
 */

import type {
  DeviceFlowPoll,
  DeviceFlowStart,
  GitHubConnectorPlatform,
  GitHubConnectorStatus,
} from "./types"
import { authTokenFromCredentials } from "@/utils/server"

export function createWebGitHubConnector(input: {
  baseUrl: string
  username?: string
  password?: string
  fetch?: typeof fetch
}): GitHubConnectorPlatform {
  const fetchImpl = input.fetch ?? globalThis.fetch
  const baseUrl = input.baseUrl.replace(/\/+$/, "")
  const headers: Record<string, string> = input.password
    ? { Authorization: `Basic ${authTokenFromCredentials({ username: input.username, password: input.password })}` }
    : {}

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    })
    if (!res.ok) throw new Error(`Connector API error: ${res.status}`)
    return (await res.json()) as T
  }

  const json = (init?: RequestInit): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...init,
  })

  return {
    getStatus: () => request<GitHubConnectorStatus>("/connector/github/status"),
    setEnabled: (enabled) =>
      request<GitHubConnectorStatus>("/connector/github/set-enabled", json({ body: JSON.stringify({ enabled }) })),
    startDeviceFlow: () => request<DeviceFlowStart>("/connector/github/device", json()),
    pollDeviceFlow: (sessionId) =>
      request<DeviceFlowPoll>("/connector/github/poll", json({ body: JSON.stringify({ sessionId }) })),
    disconnect: () => request<GitHubConnectorStatus>("/connector/github/disconnect", json()),
  }
}
