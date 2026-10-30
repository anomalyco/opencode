export * as McpSocketClient from "./socket-client.js"

import { deserializeMessage, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client"
import { Result } from "effect"

/** The side of an incoming WebSocket the transport writes to. */
export interface Socket {
  readonly send: (text: string) => void
  readonly close: (code?: number, reason?: string) => void
}

export interface SocketTransport extends Transport {
  /** Feeds one inbound text frame. */
  readonly deliver: (text: string) => void
  /** Reports that the socket closed; fires `onclose` once. */
  readonly ended: () => void
}

/**
 * MCP client transport over a WebSocket that a client app opened to the server. The app runs the
 * MCP server and opencode runs the MCP client, so only the connection direction is inverted: the
 * transport is only ever made for an incoming socket and never dials out.
 *
 * Framing: one JSON-RPC 2.0 message per text frame, JSON-encoded, without batching. A frame that is
 * not valid JSON or not a JSON-RPC message is reported through `onerror` and the connection stays
 * open. Frames that arrive before `start()` are buffered and delivered on start.
 *
 * Closing: `close()` closes the socket with 1000 (normal). The transport learns that the socket
 * closed for any other reason through `ended()`; which close codes the endpoint uses is its own
 * concern. Either way `onclose` fires exactly once, and nothing is replayed after a disconnect: a
 * reconnecting client starts a fresh MCP session.
 */
export function make(socket: Socket): SocketTransport {
  const pending: string[] = []
  let phase: "ready" | "open" | "closed" = "ready"

  const finish = () => {
    if (phase === "closed") return
    phase = "closed"
    pending.length = 0
    transport.onclose?.()
  }

  const receive = (text: string) => {
    const parsed = Result.try({
      try: () => deserializeMessage(text),
      catch: (cause) => new Error("Invalid MCP socket frame", { cause }),
    })
    if (Result.isFailure(parsed)) return transport.onerror?.(parsed.failure)
    transport.onmessage?.(parsed.success)
  }

  const transport: SocketTransport = {
    start: () => {
      if (phase === "closed") return Promise.reject(new Error("Not connected"))
      if (phase === "open") return Promise.reject(new Error("Socket transport already started"))
      phase = "open"
      while (phase === "open" && pending.length > 0) receive(pending.shift()!)
      return Promise.resolve()
    },
    send: (message: JSONRPCMessage) =>
      phase !== "open"
        ? Promise.reject(new Error("Not connected"))
        : Promise.try(() => {
            socket.send(JSON.stringify(message))
          }),
    close: () => {
      if (phase === "closed") return Promise.resolve()
      phase = "closed"
      pending.length = 0
      const closed = Result.try(() => socket.close(1000))
      transport.onclose?.()
      return Result.isFailure(closed) ? Promise.reject(closed.failure) : Promise.resolve()
    },
    deliver: (text) => {
      if (phase === "closed") return
      // Keep FIFO order when a frame arrives re-entrantly while start() is still flushing.
      if (phase === "ready" || pending.length > 0) {
        pending.push(text)
        return
      }
      receive(text)
    },
    ended: finish,
  }

  return transport
}
