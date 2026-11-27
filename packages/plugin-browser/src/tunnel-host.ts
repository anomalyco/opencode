export * as BrowserTunnelHost from "./tunnel-host.js"

import type { Location } from "@opencode/schema/location"
import type { Session } from "@opencode/schema/session"
import { Context, type Effect } from "effect"

export const STREAM_CAPABILITY = "tunnel.ws.v1" as const
export const BROWSER_TUNNEL_PATH = "/api/experimental/browser/tunnel" as const
export const CLOSE_ATTACHMENT_CLOSED = 4001
export const CLOSE_ATTACHMENT_REPLACED = 4002

/** Minimal binary WebSocket transport handed from the server upgrade handler to the browser attachment. */
export interface BinarySocket {
  readonly readyState: number
  readonly bufferedAmount: number
  send(data: Uint8Array, onWritten?: (error?: Error) => void): void
  ping?(): void
  close(code?: number, reason?: string): void
  terminate(): void
  onMessage(listener: (data: Uint8Array | string) => void): () => void
  onClose(listener: (code: number, reason: string) => void): () => void
  onError(listener: (error: Error) => void): () => void
  onPong?(listener: () => void): () => void
}

export interface TicketBinding {
  readonly location: Location.Ref
  readonly sessionID: Session.ID
  readonly connectionID: string
  readonly generation: number
  readonly protocol: number
  readonly onUpgrade: (socket: BinarySocket) => Effect.Effect<void>
}

export interface IssuedTicket {
  readonly ticket: string
  readonly expiresIn: number
  readonly protocol: number
  readonly path: string
}

/**
 * Narrow handoff interface between the server's ticket-authenticated WebSocket upgrade route
 * and the browser plugin's attachment owner. The server never opens target TCP sockets itself;
 * it only validates the single-use ticket and hands the upgraded binary socket to the attachment.
 */
export interface Interface {
  readonly enabled: Effect.Effect<boolean>
  readonly reservedLocalPorts: () => ReadonlySet<number>
  readonly issueTicket: (binding: TicketBinding) => Effect.Effect<IssuedTicket>
  readonly revokeAttachment: (sessionID: Session.ID, connectionID: string, generation: number) => Effect.Effect<void>
}

/** Optional host service; undefined in standalone unit tests without a WebSocket upgrade server. */
export const Reference = Context.Reference<Interface | undefined>("@opencode/BrowserTunnelHost", {
  defaultValue: () => undefined,
})

export interface GlobalLimits {
  readonly maxStreams: number
  readonly maxPendingConnects: number
  readonly maxBufferedBytes: number
  tryAcquireStream(): boolean
  releaseStream(): void
  tryAcquirePendingConnect(): boolean
  releasePendingConnect(): void
  tryReserveBytes(bytes: number): boolean
  releaseBytes(bytes: number): void
}

export function createGlobalLimits(
  input: {
    readonly maxStreams?: number
    readonly maxPendingConnects?: number
    readonly maxBufferedBytes?: number
  } = {},
): GlobalLimits {
  const maxStreams = input.maxStreams ?? 512
  const maxPendingConnects = input.maxPendingConnects ?? 128
  const maxBufferedBytes = input.maxBufferedBytes ?? 64 * 1024 * 1024
  let streams = 0
  let pendingConnects = 0
  let bufferedBytes = 0

  return {
    maxStreams,
    maxPendingConnects,
    maxBufferedBytes,
    tryAcquireStream() {
      if (streams >= maxStreams) return false
      streams += 1
      return true
    },
    releaseStream() {
      streams = Math.max(0, streams - 1)
    },
    tryAcquirePendingConnect() {
      if (pendingConnects >= maxPendingConnects) return false
      pendingConnects += 1
      return true
    },
    releasePendingConnect() {
      pendingConnects = Math.max(0, pendingConnects - 1)
    },
    tryReserveBytes(bytes) {
      if (bytes <= 0) return true
      if (bufferedBytes + bytes > maxBufferedBytes) return false
      bufferedBytes += bytes
      return true
    },
    releaseBytes(bytes) {
      if (bytes <= 0) return
      bufferedBytes = Math.max(0, bufferedBytes - bytes)
    },
  }
}

export const defaultGlobalLimits = createGlobalLimits()
