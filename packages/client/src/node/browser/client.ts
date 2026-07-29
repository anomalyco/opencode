import { BrowserControlProtocol } from "@opencode-ai/protocol/browser-control"
import { Browser } from "@opencode-ai/schema/browser"
import { BrowserControl } from "@opencode-ai/schema/browser-control"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Schema } from "effect"
import WebSocket from "ws"
import type { ClientOptions } from "../../promise/generated/client.js"
import { browserDriverFactory, type BrowserDriver, type BrowserDriverInstance, type BrowserProxy } from "./driver.js"
import { createBrowserProxy } from "./proxy.js"
import { openBrowserTunnel, type BrowserTunnelEndpoint } from "./tunnel.js"

export interface BrowserRegisterOptions {
  readonly sessionID: string
  readonly open: () => Promise<void> | void
}

export interface BrowserAttachOptions<Resource> {
  readonly driver: BrowserDriver<Resource>
  readonly signal?: AbortSignal
}

export interface BrowserAttachment<Resource> extends AsyncDisposable {
  readonly resource: Resource
  readonly close: () => Promise<void>
}

export interface BrowserRegistration extends AsyncDisposable {
  readonly attach: <Resource>(options: BrowserAttachOptions<Resource>) => Promise<BrowserAttachment<Resource>>
  readonly close: () => Promise<void>
}

export interface BrowserClient {
  readonly register: (options: BrowserRegisterOptions) => Promise<BrowserRegistration>
}

type ProxyServer = Awaited<ReturnType<typeof createBrowserProxy>>
type Attachment = {
  readonly leaseID: Browser.LeaseID
  readonly abort: AbortController
  readonly attached: Promise<void>
  readonly resolveAttached: () => void
  readonly rejectAttached: (error: Error) => void
  readonly externalSignal?: AbortSignal
  readonly externalAbort: () => void
  state?: Browser.State
  execute?: BrowserDriverInstance<unknown>["execute"]
  unsubscribe?: () => void
  dispose?: () => Promise<void> | void
  proxy?: ProxyServer
  acknowledged: boolean
  closed: boolean
  closing?: Promise<void>
}

export function createBrowserClient(options: ClientOptions): BrowserClient {
  const server = endpoint(options)
  return { register: (input) => BrowserRegistrationControl.create(server, input) }
}

class BrowserRegistrationControl implements BrowserRegistration {
  private readonly requests = new Map<BrowserControl.RequestID, AbortController>()
  private readonly socket: WebSocket
  private attachment?: Attachment
  private resolveRegistered!: () => void
  private rejectRegistered!: (error: Error) => void
  private readonly registered: Promise<void>
  private closed = false
  private closing?: Promise<void>

  static async create(server: BrowserTunnelEndpoint, options: BrowserRegisterOptions) {
    if (!Schema.is(Session.ID)(options.sessionID))
      throw new TypeError("Browser registration requires a valid Session ID")
    if (typeof options.open !== "function") throw new TypeError("Browser registration requires an open callback")
    if (process.versions.bun) {
      const response = await (server.fetch ?? globalThis.fetch)(new URL("/api/health", server.url), {
        headers: server.authorization ? { Authorization: server.authorization } : undefined,
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Browser control connection was rejected with HTTP ${response.status}`)
      }
    }
    const registration = new BrowserRegistrationControl(server, Session.ID.make(options.sessionID), options.open)
    await registration.registered
    return registration
  }

  private constructor(
    private readonly server: BrowserTunnelEndpoint,
    private readonly sessionID: Session.ID,
    private readonly open: BrowserRegisterOptions["open"],
  ) {
    this.registered = new Promise<void>((resolve, reject) => {
      this.resolveRegistered = resolve
      this.rejectRegistered = reject
    })
    this.socket = new WebSocket(controlURL(server), BrowserControlProtocol.Subprotocol, {
      ...(server.authorization ? { headers: { Authorization: server.authorization } } : {}),
      handshakeTimeout: 10_000,
      maxPayload: BrowserControlProtocol.MaxMessageBytes,
      perMessageDeflate: false,
      followRedirects: false,
    })
    this.socket.once("open", () => this.send({ type: "browser.control.register", sessionID }))
    this.socket.on("message", (data, binary) => void this.receive(data, binary))
    this.socket.on("error", (error) => {
      const status = /^Unexpected server response: (\d+)$/.exec(error.message)?.[1]
      this.fail(new Error(status ? `Browser control connection was rejected with HTTP ${status}` : error.message))
    })
    if (!process.versions.bun) {
      this.socket.on("unexpected-response", (_request, response) => {
        response.resume()
        this.fail(new Error(`Browser control connection was rejected with HTTP ${response.statusCode}`))
      })
    }
    this.socket.on("close", () => this.fail(new Error("Browser control connection closed.")))
  }

  async attach<Resource>(input: BrowserAttachOptions<Resource>): Promise<BrowserAttachment<Resource>> {
    if (this.closed) throw new Error("Browser registration is closed")
    if (this.attachment) throw new Error("A browser is already attached to this registration")
    if (input.signal?.aborted) throw abortError(input.signal, "Browser attachment was aborted")
    let resolveAttached!: () => void
    let rejectAttached!: (error: Error) => void
    const attached = new Promise<void>((resolve, reject) => {
      resolveAttached = resolve
      rejectAttached = reject
    })
    const externalAbort = () =>
      void this.closeAttachment(record, abortError(input.signal, "Browser attachment was aborted"))
    const record: Attachment = {
      leaseID: Browser.LeaseID.create(),
      abort: new AbortController(),
      attached,
      resolveAttached,
      rejectAttached,
      externalSignal: input.signal,
      externalAbort,
      acknowledged: false,
      closed: false,
    }
    this.attachment = record
    input.signal?.addEventListener("abort", record.externalAbort, { once: true })
    try {
      record.proxy = await createBrowserProxy({
        connect: async (target, signal) => {
          await abortable(record.attached, signal)
          return openBrowserTunnel({
            endpoint: this.server,
            sessionID: this.sessionID,
            leaseID: record.leaseID,
            target,
            signal: AbortSignal.any([signal, record.abort.signal]),
          })
        },
      })
      const instance = await Promise.resolve(
        browserDriverFactory(input.driver)({ proxy: exposedProxy(record.proxy), signal: record.abort.signal }),
      )
      if (!validDriver(instance)) throw new TypeError("Browser driver factory returned an invalid driver instance")
      record.dispose = () => instance.dispose()
      record.execute = (command, options) => instance.execute(command, options)
      record.state = contractState(instance.state())
      record.unsubscribe = instance.subscribe((state) => {
        if (record.closed) return
        record.state = contractState(state)
        if (record.acknowledged)
          this.send({ type: "browser.control.state", leaseID: record.leaseID, state: record.state })
      })
      this.send({ type: "browser.control.attach", leaseID: record.leaseID, state: record.state })
      await abortable(record.attached, record.abort.signal)
      record.acknowledged = true
      this.send({ type: "browser.control.state", leaseID: record.leaseID, state: record.state })
      const close = () => this.closeAttachment(record)
      return Object.freeze({ resource: instance.resource, close, [Symbol.asyncDispose]: close })
    } catch (error) {
      await this.closeAttachment(record).catch(() => undefined)
      throw error
    }
  }

  close() {
    if (this.closing) return this.closing
    this.closed = true
    const attachment = this.attachment
    this.closing = (attachment ? this.closeAttachment(attachment) : Promise.resolve()).finally(() => {
      this.requests.forEach((abort) => abort.abort())
      this.requests.clear()
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000)
      else if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate()
    })
    return this.closing
  }

  [Symbol.asyncDispose]() {
    return this.close()
  }

  private closeAttachment(record: Attachment, reason = new Error("Browser attachment was closed")) {
    if (record.closing) return record.closing
    record.closed = true
    record.externalSignal?.removeEventListener("abort", record.externalAbort)
    record.abort.abort(reason)
    record.rejectAttached(reason)
    if (this.attachment === record) this.attachment = undefined
    if (record.acknowledged) this.send({ type: "browser.control.detach", leaseID: record.leaseID })
    record.closing = Promise.resolve()
      .then(() => record.unsubscribe?.())
      .then(() => record.dispose?.())
      .then(() => record.proxy?.close())
    return record.closing
  }

  private async receive(data: WebSocket.RawData, binary: boolean) {
    if (binary) return this.protocolError()
    const message = await Effect.runPromise(
      BrowserControlProtocol.decodeFromServer(Buffer.from(rawData(data)).toString("utf8")),
    ).catch(() => undefined)
    if (!message) return this.protocolError()
    if (message.type === "browser.control.registered") {
      this.resolveRegistered()
      return
    }
    if (message.type === "browser.control.open") {
      queueMicrotask(() => void Promise.resolve(this.open()).catch((error) => this.fail(asError(error))))
      return
    }
    if (message.type === "browser.control.attached") {
      if (this.attachment?.leaseID !== message.leaseID) return this.protocolError()
      this.attachment.resolveAttached()
      return
    }
    if (message.type === "browser.control.cancel") {
      this.requests.get(message.requestID)?.abort(new Error("Browser command was cancelled"))
      this.requests.delete(message.requestID)
      return
    }
    void this.request(message)
  }

  private async request(message: Extract<BrowserControl.FromServer, { readonly type: "browser.control.request" }>) {
    const record = this.attachment
    if (!record?.acknowledged || record.leaseID !== message.leaseID || !record.execute) {
      this.send({
        type: "browser.control.response",
        requestID: message.requestID,
        leaseID: message.leaseID,
        outcome: { type: "failure", code: "not_attached", message: "Browser is not attached." },
      })
      return
    }
    const abort = new AbortController()
    this.requests.set(message.requestID, abort)
    const outcome = await record.execute(message.command, { signal: abort.signal }).then(
      (result): Browser.Outcome =>
        Schema.is(Browser.Result)(result) && result.type === message.command.type
          ? { type: "success", result }
          : { type: "failure", code: "protocol", message: "Browser driver returned an invalid result." },
      (error): Browser.Outcome => driverFailure(error),
    )
    if (this.requests.get(message.requestID) !== abort) return
    this.requests.delete(message.requestID)
    this.send({ type: "browser.control.response", requestID: message.requestID, leaseID: message.leaseID, outcome })
  }

  private send(message: BrowserControl.FromClient) {
    if (this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(BrowserControlProtocol.encodeFromClient(message), (error) => {
      if (error) this.fail(error)
    })
  }

  private protocolError() {
    this.fail(new Error("Invalid browser control message."))
  }

  private fail(error: Error) {
    if (this.closed) return
    this.rejectRegistered(error)
    this.attachment?.rejectAttached(error)
    void this.close()
  }
}

function validDriver<Resource>(input: BrowserDriverInstance<Resource>): input is BrowserDriverInstance<Resource> {
  return (
    input !== null &&
    typeof input === "object" &&
    typeof input.state === "function" &&
    typeof input.subscribe === "function" &&
    typeof input.execute === "function" &&
    typeof input.dispose === "function"
  )
}

function exposedProxy(proxy: ProxyServer): BrowserProxy {
  return Object.freeze({
    url: proxy.url,
    host: proxy.host,
    port: proxy.port,
    credentials: Object.freeze({ ...proxy.credentials }),
  })
}

function contractState(state: Browser.State) {
  if (!Schema.is(Browser.State)(state)) throw new TypeError("Browser driver returned an invalid state")
  return Object.freeze({ ...state })
}

function driverFailure(error: unknown): Extract<Browser.Outcome, { readonly type: "failure" }> {
  return {
    type: "failure",
    code:
      error !== null && typeof error === "object" && "code" in error && Schema.is(Browser.ErrorCode)(error.code)
        ? error.code
        : "internal",
    message: (error instanceof Error ? error.message : String(error)).slice(0, 1_024),
  }
}

function endpoint(options: ClientOptions): BrowserTunnelEndpoint {
  const url = new URL(options.baseUrl)
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new TypeError("Browser server endpoint must be an HTTP URL without embedded credentials")
  }
  const authorization = new Headers(options.headers).get("authorization") ?? undefined
  return Object.freeze({ url: url.href, ...(authorization ? { authorization } : {}), fetch: options.fetch })
}

function controlURL(endpoint: BrowserTunnelEndpoint) {
  const url = new URL(endpoint.url)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = BrowserControlProtocol.Path
  url.search = ""
  url.hash = ""
  return url
}

function abortable<Result>(promise: Promise<Result>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError(signal, "Browser operation was aborted"))
  return new Promise<Result>((resolve, reject) => {
    const abort = () => reject(abortError(signal, "Browser operation was aborted"))
    signal.addEventListener("abort", abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function abortError(signal: AbortSignal | undefined, message: string) {
  return signal?.reason instanceof Error ? signal.reason : new Error(message)
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function rawData(data: WebSocket.RawData) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}
