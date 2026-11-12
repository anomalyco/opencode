export * as ShareService from "./share-service"

import { hostname, platform, arch } from "node:os"
import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { Effect, Layer, Context, Option, Schema } from "effect"
import { getStore } from "../storage/store"
import { SidecarCredentials } from "./sidecar-credentials"
import { SHARE_ACCOUNT_KEY, SHARE_DEVICE_ID_KEY, SHARE_ENABLED_KEY, SHARE_ENVIRONMENT_KEY } from "../storage/keys"
import { VERSION } from "../constants"

// ── Share service ──────────────────────────────────────────────────────
//
// Lets other devices reach this machine through a self-hosted relay.
//
// The desktop app opens an outbound WebSocket to the relay and registers the
// local opencode server as an environment. The relay forwards client requests
// over that socket, so the machine needs no public address, no inbound port and
// no certificate of its own. This is the desktop counterpart of the client's
// relay discovery: one app is both the server and a client.
//
// Protocol (JSON, binary payloads base64-encoded), mirrored by the relay:
//   relay -> us: { type:'req', id, method, path, headers, body? }
//   relay -> us: { type:'ws-req', id, path, headers }
//   relay -> us: { type:'ws-data', id, data }
//   relay -> us: { type:'ws-close', id }
//   us -> relay: { type:'res', id, status, headers }
//   us -> relay: { type:'chunk', id, data }
//   us -> relay: { type:'end', id }
//   us -> relay: { type:'ws-open', id }
//   us -> relay: { type:'ws-data', id, data }
//   us -> relay: { type:'ws-close', id }

export type Account = {
  relayUrl: string
  username: string
  password: string
}

export type Status = {
  enabled: boolean
  state: "disabled" | "connecting" | "online" | "error"
  environmentId?: string
  environmentName?: string
  error?: string
}

export interface Interface {
  readonly status: Effect.Effect<Status>
  readonly account: Effect.Effect<Option.Option<Account>>
  readonly enable: Effect.Effect<Status>
  readonly disable: Effect.Effect<Status>
  readonly saveAccount: (account: Account) => Effect.Effect<Status>
  readonly restore: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/ShareService") {}

const HEARTBEAT_MS = 60_000

const REQUEST_TIMEOUT_MS = 30 * 60_000

const PING_INTERVAL_MS = 25_000

const MAX_RECONNECT_DELAY_MS = 30_000

const V2_PROTOCOL = "oc-tunnel-v2"

const BACKPRESSURE_LIMIT = 2 * 1024 * 1024 // 2MB

// The account the relay authenticates the desktop with.
const AccountSchema = Schema.Struct({
  relayUrl: Schema.String,
  username: Schema.String,
  password: Schema.String,
})

// The environment this device registered on the relay.
const EnvironmentSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

// The stable device id this installation reports to the relay.
const DeviceIdSchema = Schema.String

const decodeDeviceId = Schema.decodeUnknownOption(DeviceIdSchema)

// The relay's login response.
const SessionSchema = Schema.Struct({
  token: Schema.String,
})

// The relay's environment registration response.
const RegistrationSchema = Schema.Struct({
  environment: EnvironmentSchema,
})

// The relay's error response.
const RelayErrorSchema = Schema.Struct({
  error: Schema.optional(Schema.String),
})

// The header map the relay forwards with each request. The relay joins
// repeated headers, so every value is a single string.
const HeadersSchema = Schema.Record(Schema.String, Schema.String)

// A tunnel frame the relay sends to the desktop.
//
// HTTP request/response frames carry a `t` tag and stream the request body
// as binary frames. Terminal session frames carry a `type` tag and
// base64-encode binary data (terminal sessions are bidirectional and use
// text frames only).
const V2FrameSchema = Schema.Union([
  Schema.Struct({
    t: Schema.Literal(1),
    id: Schema.String,
    method: Schema.String,
    path: Schema.String,
    headers: HeadersSchema,
  }),
  Schema.Struct({ t: Schema.Literal(2), id: Schema.String }),
])

const TerminalFrameSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ws-req"),
    id: Schema.String,
    path: Schema.String,
    headers: HeadersSchema,
  }),
  Schema.Struct({ type: Schema.Literal("ws-data"), id: Schema.String, data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("ws-close"), id: Schema.String }),
])

const decodeV2Frame = Schema.decodeUnknownOption(Schema.fromJsonString(V2FrameSchema))

const decodeTerminalFrame = Schema.decodeUnknownOption(Schema.fromJsonString(TerminalFrameSchema))

// The relay's login error detail.
const decodeRelayError = Schema.decodeUnknownOption(RelayErrorSchema)

const decodeSession = Schema.decodeUnknownOption(SessionSchema)

const decodeRegistration = Schema.decodeUnknownOption(RegistrationSchema)

const decodeAccount = Schema.decodeUnknownOption(AccountSchema)

const decodeEnvironment = Schema.decodeUnknownOption(EnvironmentSchema)

// ── Binary frames ──────────────────────────────────────────────────────
//
// V2 binary frame packing/unpacking. The frame carries the request id in a
// 2-byte big-endian length prefix, so the receiver can route the payload
// without a separate text frame.

/** A decoded V2 binary frame: the request id and its raw payload. */
type BinaryFrame = {
  id: string
  data: Buffer
}

function packBinaryFrame(reqId: string, data: Buffer): Buffer {
  const idBuf = Buffer.from(reqId, "utf8")
  const header = Buffer.alloc(2)
  header.writeUInt16BE(idBuf.length, 0)

  return Buffer.concat([header, idBuf, data])
}

function unpackBinaryFrame(raw: Buffer): BinaryFrame {
  const idLen = raw.readUInt16BE(0)
  const id = raw.subarray(2, 2 + idLen).toString("utf8")
  const data = raw.subarray(2 + idLen)

  return { id, data }
}

// The name other devices see for this machine. The hostname ends in ".local"
// on macOS, which reads as noise in a server list.
function machineName() {
  const host = hostname()

  return host.endsWith(".local") ? host.slice(0, -".local".length) : host
}

// The version other devices see for this machine. The app version is what the
// user installed, so it is the number that identifies the build.
function environmentVersion() {
  return VERSION
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = getStore()

    let socket: WebSocket | undefined
    let environmentId: string | undefined
    let environmentName: string | undefined
    let state: Status["state"] = "disabled"
    let lastError: string | undefined
    let heartbeat: NodeJS.Timeout | undefined
    let reconnectTimer: NodeJS.Timeout | undefined
    let reconnectAttempts = 0
    let generation = 0

    // Requests the relay forwarded but that have not finished yet.
    const pending = new Map<string, { resolve: (value: Response) => void; reject: (error: Error) => void }>()
    // Terminal sessions the relay forwarded, keyed by the tunnel request id.
    const sockets = new Map<string, { socket: WebSocket; relay: WebSocket }>()

    const read = (key: string) => store.get(key)

    const write = (key: string, value: Schema.Json) => {
      store.set(key, value)
    }

    const remove = (key: string) => {
      store.delete(key)
    }

    const current = (): Status => {
      const status: Status = { enabled: state !== "disabled", state }

      if (environmentId) status.environmentId = environmentId

      if (environmentName) status.environmentName = environmentName

      if (lastError) status.error = lastError

      return status
    }

    const savedAccount = () => Option.fromUndefinedOr(Option.getOrUndefined(decodeAccount(read(SHARE_ACCOUNT_KEY))))
    const savedEnvironment = () => Option.getOrUndefined(decodeEnvironment(read(SHARE_ENVIRONMENT_KEY)))

    // A stable identity for this installation. The relay uses it to recognise
    // re-registrations of the same machine instead of piling up duplicates.
    const deviceId = () => {
      const saved = Option.getOrUndefined(decodeDeviceId(read(SHARE_DEVICE_ID_KEY)))

      if (saved) return saved
      const generated = randomUUID()
      write(SHARE_DEVICE_ID_KEY, generated)

      return generated
    }

    const api = async (
      account: Account,
      pathname: string,
      init: { method?: string; body?: Schema.Json; token?: string } = {},
    ) => {
      const headers: Record<string, string> = {}

      if (init.token) headers.authorization = `Bearer ${init.token}`

      if (init.body !== undefined) headers["content-type"] = "application/json"

      const response = await fetch(new URL(pathname, account.relayUrl), {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })

      const text = await response.text()
      let parsed: unknown = undefined

      try {
        parsed = text ? JSON.parse(text) : undefined
      } catch {
        parsed = undefined
      }

      if (!response.ok) {
        const detail =
          Option.getOrUndefined(decodeRelayError(parsed))?.error ?? response.statusText ?? `HTTP ${response.status}`

        throw new Error(detail)
      }

      return parsed
    }

    const login = async (account: Account) => {
      const result = await api(account, "/api/auth/login", {
        method: "POST",
        body: { username: account.username, password: account.password, deviceLabel: "opencode-desktop" },
      })

      const token = Option.getOrUndefined(decodeSession(result))?.token

      if (!token) throw new Error("Relay did not return a session token")

      return token
    }

    // The relay reports bad credentials as "invalid credentials". The renderer
    // translates this marker, so the UI can show a localized message.
    function describeError(cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause)

      if (message.toLowerCase().includes("invalid credentials")) return "invalid_credentials"

      return message
    }

    // Registers the local opencode server on the relay, or updates the
    // environment that a previous run already registered.
    //
    // The relay matches an existing entry by deviceId (or hostname), so the
    // same machine always resolves to the same environment id — no duplicate
    // entries in the other devices' discovery list.
    const registerEnvironment = async (account: Account, token: string, name: string) => {
      const payload = {
        name,
        description: `opencode on ${machineName()}`,
        url: "",
        username: "opencode",
        password: "",
        hostname: hostname(),
        deviceId: deviceId(),
        version: environmentVersion(),
        platform: `${platform()}-${arch()}`,
        status: "online",
      }

      const created = await api(account, "/api/environments", { method: "POST", token, body: payload })
      const registration = Option.getOrUndefined(decodeRegistration(created))

      if (!registration) throw new Error("Relay did not return an environment")

      return registration.environment
    }

    // A frame the desktop sends to the relay. The relay decodes the same shapes.
    type OutboundFrame =
      | { t: 3; id: string; status: number; headers: Record<string, string> }
      | { t: 4; id: string }
      | { type: "ws-open"; id: string }
      | { type: "ws-data"; id: string; data: string }
      | { type: "ws-close"; id: string }

    const send = (message: OutboundFrame) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(message))

      return true
    }

    // Sends a raw response body over the V2 binary channel.
    const sendBinary = (id: string, data: Buffer): boolean => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false

      if (socket.bufferedAmount > BACKPRESSURE_LIMIT) return false
      socket.send(packBinaryFrame(id, data), { binary: true })

      return true
    }

    // Waits for the socket to drain once its backlog exceeds the limit.
    const waitForDrain = (): Promise<void> =>
      new Promise((resolve) => {
        if (!socket || socket.bufferedAmount <= BACKPRESSURE_LIMIT) {
          resolve()

          return
        }

        const onDrain = () => {
          socket?.off("drain", onDrain)
          resolve()
        }

        socket?.on("drain", onDrain)
      })

    // Forwards one relayed HTTP request to the local opencode server and
    // streams the response back over the tunnel as binary frames.
    const handleRequest = async (message: {
      id: string
      method: string
      path: string
      headers: Record<string, string>
      bodyBuffer?: Buffer
    }) => {
      const local = localEndpoint()

      if (!local) {
        send({ t: 3, id: message.id, status: 503, headers: { "content-type": "application/json" } })
        send({ t: 4, id: message.id })

        return
      }

      const headers = new Headers()

      for (const [key, value] of Object.entries(message.headers ?? {})) {
        if (["host", "connection", "content-length", "accept-encoding"].includes(key.toLowerCase())) continue

        if (key.toLowerCase() === "authorization") continue

        try {
          headers.set(key, value)
        } catch {
          // Ignore header names the fetch API rejects.
        }
      }

      headers.set("accept-encoding", "identity")

      if (local.authorization) headers.set("authorization", local.authorization)

      const body = message.bodyBuffer
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const hasBody = body !== undefined && message.method !== "GET" && message.method !== "HEAD"

      try {
        const response = await fetch(new URL(message.path, local.url), {
          method: message.method,
          headers,
          // SAFETY: `body` is a Buffer, which the fetch API accepts as a binary body.
          body: hasBody ? (body as BodyInit) : undefined,
          signal: controller.signal,
          redirect: "manual",
        })

        const out: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          const lower = key.toLowerCase()

          if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(lower)) return
          out[key] = value
        })

        // The response headers travel in a text frame; the body follows as binary frames.
        send({ t: 3, id: message.id, status: response.status, headers: out })

        if (!response.body) {
          send({ t: 4, id: message.id })

          return
        }

        // Stream the body so server-sent events reach the client in real time.
        const reader = response.body.getReader()

        for (;;) {
          const { done, value } = await reader.read()

          if (done) break

          // Backpressure: wait for the socket to drain once its backlog is over the limit.
          if (socket && socket.bufferedAmount > BACKPRESSURE_LIMIT) {
            await waitForDrain()
          }

          sendBinary(message.id, Buffer.from(value))
        }

        send({ t: 4, id: message.id })
      } catch (error) {
        if (!send({ t: 3, id: message.id, status: 502, headers: { "content-type": "application/json" } })) return
        send({ t: 4, id: message.id })
      } finally {
        clearTimeout(timer)
      }
    }

    // Terminal sessions: the relay forwards an HTTP upgrade, so the desktop
    // opens its own WebSocket to the local server and pipes both directions.
    const handleWebSocketRequest = (message: { id: string; path: string; headers: Record<string, string> }) => {
      const local = localEndpoint()

      if (!local) {
        send({ type: "ws-close", id: message.id })

        return
      }

      const target = new URL(message.path, local.url)
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:"

      const upstream = new WebSocket(target, {
        headers: {
          ...message.headers,
          authorization: local.authorization,
        },
      })

      sockets.set(message.id, { socket: upstream, relay: socket! })

      upstream.on("open", () => {
        send({ type: "ws-open", id: message.id })
      })
      upstream.on("message", (data: Buffer) => {
        send({ type: "ws-data", id: message.id, data: data.toString("base64") })
      })
      upstream.on("close", () => {
        sockets.delete(message.id)
        send({ type: "ws-close", id: message.id })
      })
      upstream.on("error", () => {
        sockets.delete(message.id)
      })
    }

    // The relay asks the desktop to forward a request; this is the only
    // inbound direction, so the handler owns the whole message dispatch.
    // A binary frame carries raw request-body bytes; a text frame carries
    // JSON metadata (`t` for HTTP request/response, `type` for terminal
    // sessions).
    const v2PendingRequests = new Map<string, { method: string; path: string; headers: Record<string, string>; bodyChunks: Buffer[] }>()

    const handleMessage = (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // A binary frame carries the raw request body; append it to its request.
        const { id, data } = unpackBinaryFrame(raw)
        const entry = v2PendingRequests.get(id)

        if (entry) entry.bodyChunks.push(data)

        return
      }

      const text = raw.toString()
      const v2 = Option.getOrUndefined(decodeV2Frame(text))

      if (v2) {
        // Request start: open the request body buffer.
        if (v2.t === 1) {
          v2PendingRequests.set(v2.id, {
            method: v2.method,
            path: v2.path,
            headers: v2.headers,
            bodyChunks: [],
          })

          return
        }

        // Request end: concatenate the chunks and run the request.
        const entry = v2PendingRequests.get(v2.id)

        if (!entry) return
        v2PendingRequests.delete(v2.id)
        void handleRequest({
          id: v2.id,
          method: entry.method,
          path: entry.path,
          headers: entry.headers,
          bodyBuffer: entry.bodyChunks.length > 0 ? Buffer.concat(entry.bodyChunks) : undefined,
        })

        return
      }

      const terminal = Option.getOrUndefined(decodeTerminalFrame(text))

      if (!terminal) return

      // Terminal session: the relay proxies WebSocket upgrades through the
      // tunnel as JSON text frames with base64-encoded data.
      if (terminal.type === "ws-req") {
        handleWebSocketRequest({
          id: terminal.id,
          path: terminal.path,
          headers: terminal.headers,
        })

        return
      }

      if (terminal.type === "ws-data") {
        const entry = sockets.get(terminal.id)

        if (!entry) return
        entry.socket.send(Buffer.from(terminal.data, "base64"))

        return
      }

      if (terminal.type === "ws-close") {
        const entry = sockets.get(terminal.id)

        if (!entry) return
        sockets.delete(terminal.id)
        entry.socket.close()
      }
    }

    // The local opencode server this app already runs. The share module
    // forwards to it, so the relay never needs to know a public address.
    const localEndpoint = () => {
      const sidecar = SidecarCredentials.get()

      if (!sidecar) return undefined

      const url = new URL(sidecar.url)

      if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"

      return {
        url: url.origin,
        authorization: SidecarCredentials.authorization(sidecar, sidecar.url),
      }
    }

    const connect = async (account: Account, name: string) => {
      const token = await login(account)
      const environment = await registerEnvironment(account, token, name)
      environmentId = environment.id
      environmentName = environment.name

      const tunnelUrl = new URL(`/api/tunnel/${environment.id}`, account.relayUrl)
      tunnelUrl.protocol = tunnelUrl.protocol === "https:" ? "wss:" : "ws:"

      const currentGeneration = ++generation

      const next = new WebSocket(tunnelUrl, V2_PROTOCOL, {
        headers: { authorization: `Bearer ${token}` },
      })

      socket = next

      // Liveness probe: detect zombie connections that survive network
      // changes (Wi-Fi switch, VPN toggle, sleep/wake). Without this the
      // TCP layer reports ESTABLISHED forever, the 'close' event never fires,
      // and the relay marks us offline while the local state stays "online".
      let pongReceived = true

      const pingTimer = setInterval(() => {
        if (currentGeneration !== generation) {
          clearInterval(pingTimer)

          return
        }

        if (!pongReceived) {
          next.terminate()

          return
        }

        pongReceived = false
        next.ping()
      }, PING_INTERVAL_MS)

      next.on("pong", () => {
        pongReceived = true
      })

      next.on("open", () => {
        if (currentGeneration !== generation) return
        state = "online"
        lastError = undefined
        reconnectAttempts = 0
        write(SHARE_ENVIRONMENT_KEY, { id: environment.id, name: environment.name })
        startHeartbeat(account, token)
      })
      next.on("message", (raw: Buffer, isBinary: boolean) => handleMessage(raw, isBinary))
      next.on("error", (error: Error) => {
        if (currentGeneration !== generation) return
        lastError = error instanceof Error ? error.message : String(error)
        state = "error"
      })
      next.on("close", () => {
        if (currentGeneration !== generation) return
        clearInterval(pingTimer)
        state = "error"
        stopHeartbeat()
        scheduleReconnect(account, name)
      })
    }

    const scheduleReconnect = (account: Account, name: string) => {
      stopReconnect()

      if (state === "disabled") return
      const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS)
      reconnectAttempts += 1
      state = "connecting"
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined
        void connect(account, name).catch((error) => {
          state = "error"
          lastError = describeError(error)
          scheduleReconnect(account, name)
        })
      }, delay)
    }

    const stopReconnect = () => {
      if (!reconnectTimer) return
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }

    const startHeartbeat = (account: Account, token: string) => {
      stopHeartbeat()
      heartbeat = setInterval(() => {
        if (!environmentId) return
        void api(account, `/api/environments/${environmentId}/heartbeat`, {
          method: "POST",
          token,
          body: { hostname: hostname(), platform: `${platform()}-${arch()}`, version: environmentVersion() },
        }).catch(() => undefined)
      }, HEARTBEAT_MS)
    }

    const stopHeartbeat = () => {
      if (!heartbeat) return
      clearInterval(heartbeat)
      heartbeat = undefined
    }

    const teardown = () => {
      generation += 1
      stopHeartbeat()
      stopReconnect()
      reconnectAttempts = 0
      sockets.forEach((entry) => entry.socket.close())
      sockets.clear()
      pending.clear()
      socket?.close()
      socket = undefined
    }

    const enable = Effect.sync(() => {
      const account = savedAccount()

      if (Option.isNone(account)) {
        state = "error"
        lastError = "No relay account saved"

        return current()
      }

      teardown()
      state = "connecting"
      lastError = undefined
      store.set(SHARE_ENABLED_KEY, "true")

      // Fire and forget: connect() updates state through its socket callbacks.
      void connect(account.value, machineName()).catch((error) => {
        state = "error"
        lastError = describeError(error)
        scheduleReconnect(account.value, machineName())
      })

      return current()
    })

    const disable = Effect.sync(() => {
      const previousAccount = savedAccount()
      const previousEnvironmentId = environmentId ?? savedEnvironment()?.id

      teardown()
      state = "disabled"
      lastError = undefined
      environmentId = undefined
      environmentName = undefined
      store.delete(SHARE_ENABLED_KEY)
      remove(SHARE_ENVIRONMENT_KEY)

      // Best effort: unregister this machine from the relay so other devices no
      // longer see it as an available server. The saved account stays so the
      // user can re-enable sharing without re-entering credentials.
      if (Option.isSome(previousAccount) && previousEnvironmentId) {
        const account = previousAccount.value
        void (async () => {
          try {
            const token = await login(account)
            await api(account, `/api/environments/${previousEnvironmentId}`, { method: "DELETE", token })
          } catch {
            // The relay may be unreachable; disabling still succeeds locally.
          }
        })()
      }

      return current()
    })

    const status = Effect.sync(current)

    const account = Effect.sync(savedAccount)

    // Saving the account verifies the credentials against the relay first, so
    // a wrong password is reported here instead of failing silently in the
    // background tunnel.
    const saveAccount = (next: Account) =>
      Effect.promise(async () => {
        try {
          await login(next)
        } catch (error) {
          state = "error"
          lastError = describeError(error)

          return current()
        }

        write(SHARE_ACCOUNT_KEY, next)
        state = "disabled"
        lastError = undefined

        return current()
      })

    // Restore a previously enabled share when the app starts.
    const restore = Effect.sync(() => {
      if (store.get(SHARE_ENABLED_KEY) !== "true") return
      const saved = savedAccount()

      if (Option.isNone(saved)) return
      state = "connecting"
      void connect(saved.value, machineName()).catch((error) => {
        state = "error"
        lastError = describeError(error)
        scheduleReconnect(saved.value, machineName())
      })
    })

    return Service.of({ status, account, enable, disable, saveAccount, restore })
  }),
)
