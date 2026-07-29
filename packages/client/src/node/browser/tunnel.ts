import { BrowserTunnelProtocol } from "@opencode-ai/protocol/browser-tunnel"
import { Browser } from "@opencode-ai/schema/browser"
import { BrowserTunnel } from "@opencode-ai/schema/browser-tunnel"
import { Session } from "@opencode-ai/schema/session"
import { Effect } from "effect"
import { Duplex } from "node:stream"
import WebSocket from "ws"

export type BrowserTunnelEndpoint = {
  readonly url: string
  readonly authorization?: string
  readonly fetch?: typeof globalThis.fetch
}

export type BrowserTunnelOpen = {
  readonly endpoint: BrowserTunnelEndpoint
  readonly sessionID: Session.ID
  readonly leaseID: Browser.LeaseID
  readonly target: BrowserTunnel.Target
  readonly signal?: AbortSignal
}

export class BrowserTunnelError extends Error {
  constructor(
    readonly code: BrowserTunnel.OpenErrorCode | "transport",
    message: string,
  ) {
    super(message)
    this.name = "BrowserTunnelError"
  }
}

/** Opens one WebSocket whose binary messages are the bytes of one TCP connection. */
export async function openBrowserTunnel(input: BrowserTunnelOpen): Promise<Duplex> {
  const tunnel = new BrowserTunnelStream(input)
  await tunnel.opened
  return tunnel
}

class BrowserTunnelStream extends Duplex {
  readonly connecting = false
  readonly opened: Promise<void>
  private resolveOpened!: () => void
  private rejectOpened!: (error: Error) => void
  private readonly socket: WebSocket
  private readonly signal?: AbortSignal
  private state: "opening" | "open" | "closed" = "opening"
  private paused = false
  private timer?: ReturnType<typeof setTimeout>

  constructor(input: BrowserTunnelOpen) {
    super()
    this.opened = new Promise<void>((resolve, reject) => {
      this.resolveOpened = resolve
      this.rejectOpened = reject
    })
    this.on("error", () => undefined)
    this.signal = input.signal
    this.socket = new WebSocket(endpointURL(input.endpoint), BrowserTunnelProtocol.Subprotocol, {
      ...(input.endpoint.authorization ? { headers: { Authorization: input.endpoint.authorization } } : {}),
      handshakeTimeout: 10_000,
      maxPayload: BrowserTunnelProtocol.MaxFrameBytes,
      perMessageDeflate: false,
      followRedirects: false,
    })
    this.timer = setTimeout(
      () => this.fail(new BrowserTunnelError("transport", "Browser tunnel handshake timed out.")),
      15_000,
    )
    this.timer.unref()
    this.socket.once("open", () => {
      this.socket.send(
        BrowserTunnelProtocol.encodeFromClient({
          type: "browser.tunnel.open",
          sessionID: input.sessionID,
          leaseID: input.leaseID,
          target: input.target,
        }),
      )
    })
    this.socket.on("message", (data, binary) => void this.receive(data, binary))
    this.socket.on("error", (error) => this.fail(new BrowserTunnelError("transport", error.message)))
    this.socket.on("close", () => {
      if (this.state === "opening")
        this.fail(new BrowserTunnelError("transport", "Browser tunnel closed while opening."))
      if (this.state !== "open") return
      this.state = "closed"
      this.push(null)
      this.destroy()
    })
    this.signal?.addEventListener("abort", this.onAbort, { once: true })
    if (this.signal?.aborted) this.onAbort()
  }

  override _read() {
    if (!this.paused) return
    this.paused = false
    this.socket.resume()
  }

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (this.state !== "open") {
      callback(new BrowserTunnelError("transport", "Browser tunnel is not writable."))
      return
    }
    const data = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk
    const frames = Array.from(
      { length: Math.ceil(data.byteLength / BrowserTunnelProtocol.MaxFrameBytes) },
      (_, index) =>
        data.subarray(index * BrowserTunnelProtocol.MaxFrameBytes, (index + 1) * BrowserTunnelProtocol.MaxFrameBytes),
    )
    const send = (index: number) => {
      if (index === frames.length) {
        callback()
        return
      }
      this.socket.send(frames[index], { binary: true }, (error) => {
        if (error) callback(error)
        else send(index + 1)
      })
    }
    send(0)
  }

  override _final(callback: (error?: Error | null) => void) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000)
    callback()
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    if (this.timer) clearTimeout(this.timer)
    this.signal?.removeEventListener("abort", this.onAbort)
    if (this.state === "opening" && error) this.rejectOpened(error)
    this.state = "closed"
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000)
    else if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate()
    callback(error)
  }

  setKeepAlive() {
    return this
  }

  setNoDelay() {
    return this
  }

  setTimeout(_timeout: number, callback?: () => void) {
    if (callback) this.once("timeout", callback)
    return this
  }

  ref() {
    return this
  }

  unref() {
    return this
  }

  private async receive(data: WebSocket.RawData, binary: boolean) {
    if (this.state === "opening") {
      if (binary) return this.fail(new BrowserTunnelError("transport", "Browser tunnel handshake must be text."))
      const message = await Effect.runPromise(
        BrowserTunnelProtocol.decodeFromServer(Buffer.from(rawData(data)).toString("utf8")),
      ).catch(() => undefined)
      if (!message) return this.fail(new BrowserTunnelError("transport", "Browser tunnel handshake is invalid."))
      if (message.type === "browser.tunnel.rejected")
        return this.fail(new BrowserTunnelError(message.code, message.message))
      this.state = "open"
      if (this.timer) clearTimeout(this.timer)
      this.resolveOpened()
      return
    }
    if (this.state !== "open" || !binary)
      return this.fail(new BrowserTunnelError("transport", "Browser tunnel payload is invalid."))
    if (!this.push(rawData(data))) {
      this.paused = true
      this.socket.pause()
    }
  }

  private fail(error: BrowserTunnelError) {
    if (this.state === "closed") return
    if (this.state === "opening") this.rejectOpened(error)
    this.destroy(error)
  }

  private readonly onAbort = () => this.fail(new BrowserTunnelError("transport", "Browser tunnel was cancelled."))
}

function endpointURL(endpoint: BrowserTunnelEndpoint) {
  const url = new URL(endpoint.url)
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new TypeError("Browser server endpoint must be an HTTP URL without embedded credentials")
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = BrowserTunnelProtocol.Path
  url.search = ""
  url.hash = ""
  return url
}

function rawData(data: WebSocket.RawData) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}
