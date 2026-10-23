import { Effect, Predicate } from "effect"
import { WebSocket } from "ws"
import {
  extensionProtocolCompatibility,
  type ExtensionCommand,
  type ExtensionProtocolCompatibility,
  type ExtensionResponse,
  type JsonObject,
  type JsonValue,
} from "./protocol.ts"
import type { PendingExtensionRequest } from "./relay-types.ts"

export type ExtensionRpcTimeouts = {
  readonly commandTimeoutMs?: number
  readonly debuggerCommandTimeoutMs?: number
  readonly livenessProbeTimeoutMs?: number
}

/**
 * Request/response correlator for the single extension websocket.
 *
 * A timed-out command fails only that command. Connection teardown is reserved
 * for a failed websocket-level liveness probe, so one hung debugger command
 * (for example a dialog-blocked tab) cannot destroy every attached tab's relay
 * state.
 */
export class ExtensionRpc {
  private socket: WebSocket | undefined
  private ready = false
  private nextRequestId = 1
  private readonly pendingRequests = new Map<number, PendingExtensionRequest>()
  private livenessProbe: { readonly timeout: NodeJS.Timeout; readonly socket: WebSocket; readonly onPong: () => void } | undefined
  version: string | undefined
  protocolVersion: number | null | undefined
  protocolCompatible: boolean | undefined
  protocolLegacy: boolean | undefined

  constructor(private readonly timeouts: ExtensionRpcTimeouts = {}) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.ready && this.protocolCompatible !== false
  }

  get acceptsEvents(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.protocolCompatible === true
  }

  isCurrent(socket: WebSocket): boolean {
    return this.socket === socket
  }

  replaceSocket(socket: WebSocket): void {
    this.rejectPending(new Error("Extension replaced"))
    this.socket?.close(4001, "Extension replaced")
    this.resetConnectionState(socket)
  }

  markHandshake(version: string | undefined, reportedProtocolVersion: JsonValue | undefined): ExtensionProtocolCompatibility {
    const protocol = extensionProtocolCompatibility(reportedProtocolVersion)
    this.version = version
    this.protocolVersion = protocol.version
    this.protocolCompatible = protocol.compatible
    this.protocolLegacy = protocol.legacy
    return protocol
  }

  markReady(): void {
    if (this.protocolCompatible === true) {
      this.ready = true
    }
  }

  disconnectIfCurrent(socket: WebSocket): boolean {
    if (this.socket !== socket) {
      return false
    }
    this.resetConnectionState(undefined)
    this.rejectPending(new Error("Extension disconnected"))
    return true
  }

  private resetConnectionState(socket: WebSocket | undefined): void {
    this.cancelLivenessProbe()
    this.socket = socket
    this.ready = false
    this.version = undefined
    this.protocolVersion = undefined
    this.protocolCompatible = undefined
    this.protocolLegacy = undefined
  }

  close(): void {
    this.cancelLivenessProbe()
    this.socket?.close()
  }

  rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
  }

  rejectDebuggerCommandsForTab(tabId: number, error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.debuggerTabId !== tabId) {
        continue
      }
      pending.reject(error)
    }
  }

  handleResponse(response: ExtensionResponse): boolean {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      return false
    }
    if (response.error) {
      pending.reject(new Error(response.error))
      return true
    }
    pending.resolve(response.result ?? {})
    return true
  }

  send(command: Omit<ExtensionCommand, "id">): Effect.Effect<JsonObject, Error> {
    return Effect.callback<JsonObject, Error>((resume) => {
      const socket = this.socket
      if (this.protocolCompatible === false) {
        resume(Effect.fail(new Error(`OpenCode Browser extension protocol ${this.protocolVersion ?? "unknown"} is incompatible`)))
        return Effect.void
      }
      if (!socket || socket.readyState !== WebSocket.OPEN || !this.acceptsEvents) {
        resume(Effect.fail(new Error("OpenCode Browser extension is not connected")))
        return Effect.void
      }

      const id = this.nextRequestId++
      const message: ExtensionCommand = { ...command, id }
      let completed = false
      const timeoutMs = command.method === "debugger.sendCommand"
        ? this.timeouts.debuggerCommandTimeoutMs ?? 60_000
        : this.timeouts.commandTimeoutMs ?? 15_000
      const finish = (effect: Effect.Effect<JsonObject, Error>) => {
        if (completed) {
          return
        }
        completed = true
        clearTimeout(timeout)
        this.pendingRequests.delete(id)
        resume(effect)
      }
      const timeout = setTimeout(() => {
        // Fail only this command. Close the socket only if the websocket
        // itself is unresponsive to a protocol-level ping.
        this.probeLiveness(socket)
        finish(Effect.fail(new Error(`Extension command timed out after ${timeoutMs}ms: ${command.method}`)))
      }, timeoutMs)
      const debuggerTabId = command.method === "debugger.sendCommand" && Predicate.isNumber(command.params?.tabId)
        ? command.params.tabId
        : undefined
      this.pendingRequests.set(id, {
        resolve: (value) => {
          finish(Effect.succeed(value))
        },
        reject: (error) => {
          finish(Effect.fail(error))
        },
        ...(debuggerTabId === undefined ? {} : { debuggerTabId }),
      })
      try {
        socket.send(JSON.stringify(message), (error) => {
          if (error) {
            finish(Effect.fail(new Error(`send extension command: ${command.method}`, { cause: error })))
          }
        })
      } catch (error) {
        finish(Effect.fail(new Error(`send extension command: ${command.method}`, { cause: error })))
      }
      return Effect.sync(() => {
        completed = true
        clearTimeout(timeout)
        this.pendingRequests.delete(id)
      })
    })
  }

  probeLiveness(socket = this.socket): void {
    if (!socket || this.socket !== socket || this.livenessProbe || socket.readyState !== WebSocket.OPEN) {
      return
    }
    const probeTimeoutMs = this.timeouts.livenessProbeTimeoutMs ?? 10_000
    const onPong = () => {
      if (this.livenessProbe?.socket !== socket) return
      this.cancelLivenessProbe()
    }
    const timeout = setTimeout(() => {
      if (this.livenessProbe?.socket !== socket) return
      this.cancelLivenessProbe()
      socket.close(4002, "Extension websocket did not answer liveness probe")
    }, probeTimeoutMs)
    this.livenessProbe = { timeout, socket, onPong }
    socket.on("pong", onPong)
    try {
      socket.ping()
    } catch {
      // If ping cannot be sent the socket is already failing; let the probe
      // timeout close it.
    }
  }

  private cancelLivenessProbe(): void {
    if (this.livenessProbe) {
      clearTimeout(this.livenessProbe.timeout)
      this.livenessProbe.socket.off("pong", this.livenessProbe.onPong)
      this.livenessProbe = undefined
    }
  }
}
