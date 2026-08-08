import { Buffer } from "node:buffer"
import type { RemotePairingInfo, ServerReadyData } from "../preload/types"
import type { RemoteGatewayInfo } from "./remote-gateway"

type Gateway = {
  start(): Promise<RemoteGatewayInfo>
  stop(): Promise<void>
  status(): RemoteGatewayInfo | undefined
}

type RemotePairingControllerOptions = {
  getSidecar: () => Promise<ServerReadyData>
  gateway: Gateway
  fetch?: typeof globalThis.fetch
}

type PairingPayload = {
  ticket?: unknown
  expires_in?: unknown
}

export function createRemotePairingController(options: RemotePairingControllerOptions) {
  const sessions = new Map<string, string>()
  let creating = 0
  let ownsGateway = false
  let stopping: Promise<void> | undefined

  const request = async (method: "GET" | "POST" | "DELETE", path: string, directory: string) => {
    const sidecar = await options.getSidecar()
    const url = new URL(path, sidecar.url)
    url.searchParams.set("directory", directory)

    const headers = new Headers()
    if (sidecar.password) {
      const username = sidecar.username ?? "opencode"
      headers.set("authorization", `Basic ${Buffer.from(`${username}:${sidecar.password}`).toString("base64")}`)
    }

    return (options.fetch ?? globalThis.fetch)(url, { method, headers })
  }

  const adminRequest = (method: "POST" | "DELETE", sessionID: string, directory: string) =>
    request(method, `/session/${encodeURIComponent(sessionID)}/remote`, directory)

  const pruneSessions = async () => {
    if (!ownsGateway || sessions.size === 0) return
    const snapshot = [...sessions.entries()]
    await Promise.all(
      snapshot.map(async ([sessionID, directory]) => {
        const response = await request("GET", `/session/${encodeURIComponent(sessionID)}`, directory).catch(() => undefined)
        if (response?.status === 404 && sessions.get(sessionID) === directory) sessions.delete(sessionID)
      }),
    )
  }

  const stopIfIdle = async (prune = false) => {
    if (!ownsGateway || creating > 0) return
    if (prune) await pruneSessions()
    if (!ownsGateway || creating > 0 || sessions.size > 0) return
    if (stopping) return stopping

    stopping = options.gateway
      .stop()
      .then(() => {
        ownsGateway = false
      })
      .finally(() => {
        stopping = undefined
      })
    return stopping
  }

  const create = async (sessionID: string, directory: string): Promise<RemotePairingInfo> => {
    if (stopping) await stopping

    creating += 1
    try {
      const initial = options.gateway.status()
      if (!initial && creating === 1) {
        sessions.clear()
        ownsGateway = false
      } else if (initial && creating === 1) {
        await pruneSessions()
      }

      const existing = options.gateway.status()
      const gateway = existing ?? (await options.gateway.start())
      if (!existing) ownsGateway = true
      if (gateway.urls.length === 0) {
        throw new Error("No local network address is available for remote control")
      }

      const response = await adminRequest("POST", sessionID, directory)
      if (!response.ok) throw new Error(`Remote pairing failed with status ${response.status}`)

      const payload = (await response.json()) as PairingPayload
      if (typeof payload.ticket !== "string" || typeof payload.expires_in !== "number") {
        throw new Error("Remote pairing returned an invalid response")
      }

      const urls = gateway.urls.map((base) => {
        const mobile = new URL("/remote/mobile", base)
        return `${mobile.toString()}#ticket=${encodeURIComponent(payload.ticket as string)}`
      })

      sessions.set(sessionID, directory)
      return {
        url: urls[0]!,
        urls,
        expiresIn: payload.expires_in,
      }
    } finally {
      creating -= 1
      await stopIfIdle().catch(() => undefined)
    }
  }

  const revoke = async (sessionID: string, directory: string) => {
    if (stopping) await stopping

    const response = await adminRequest("DELETE", sessionID, directory)
    if (!response.ok) throw new Error(`Remote revoke failed with status ${response.status}`)
    if (!sessions.delete(sessionID)) return
    await stopIfIdle(true)
  }

  return { create, revoke }
}
