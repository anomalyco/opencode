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
  const request = async (method: "POST" | "DELETE", sessionID: string, directory: string) => {
    const sidecar = await options.getSidecar()
    const url = new URL(`/session/${encodeURIComponent(sessionID)}/remote`, sidecar.url)
    url.searchParams.set("directory", directory)

    const headers = new Headers()
    if (sidecar.password) {
      const username = sidecar.username ?? "opencode"
      headers.set("authorization", `Basic ${Buffer.from(`${username}:${sidecar.password}`).toString("base64")}`)
    }

    return (options.fetch ?? globalThis.fetch)(url, { method, headers })
  }

  const create = async (sessionID: string, directory: string): Promise<RemotePairingInfo> => {
    const existing = options.gateway.status()
    const gateway = existing ?? (await options.gateway.start())

    if (gateway.urls.length === 0) {
      if (!existing) await options.gateway.stop()
      throw new Error("No local network address is available for remote control")
    }

    try {
      const response = await request("POST", sessionID, directory)
      if (!response.ok) throw new Error(`Remote pairing failed with status ${response.status}`)

      const payload = (await response.json()) as PairingPayload
      if (typeof payload.ticket !== "string" || typeof payload.expires_in !== "number") {
        throw new Error("Remote pairing returned an invalid response")
      }

      const urls = gateway.urls.map((base) => {
        const mobile = new URL("/remote/mobile", base)
        return `${mobile.toString()}#ticket=${encodeURIComponent(payload.ticket as string)}`
      })

      return {
        url: urls[0]!,
        urls,
        expiresIn: payload.expires_in,
      }
    } catch (error) {
      if (!existing) await options.gateway.stop().catch(() => undefined)
      throw error
    }
  }

  const revoke = async (sessionID: string, directory: string) => {
    const response = await request("DELETE", sessionID, directory)
    if (!response.ok) throw new Error(`Remote revoke failed with status ${response.status}`)
  }

  return { create, revoke }
}
