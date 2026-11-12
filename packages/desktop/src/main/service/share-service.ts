export * as ShareService from "./share-service"

import { hostname, platform, arch } from "node:os"
import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { Effect, Layer, Context, Option } from "effect"
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

// V2 二进制帧打包/解包
function packBinaryFrame(reqId: string, data: Buffer): Buffer {
  const idBuf = Buffer.from(reqId, "utf8")
  const header = Buffer.alloc(2)
  header.writeUInt16BE(idBuf.length, 0)
  return Buffer.concat([header, idBuf, data])
}

function unpackBinaryFrame(raw: Buffer): { id: string; data: Buffer } {
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

    const read = <T,>(key: string): T | undefined => {
      const raw = store.get(key)
      if (raw === undefined) return undefined
      if (typeof raw !== "string") return undefined

      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    }

    const write = (key: string, value: unknown) => {
      store.set(key, JSON.stringify(value))
    }

    const remove = (key: string) => {
      store.delete(key)
    }

    const current = (): Status => ({
      enabled: state !== "disabled",
      state,
      ...(environmentId ? { environmentId } : {}),
      ...(environmentName ? { environmentName } : {}),
      ...(lastError ? { error: lastError } : {}),
    })

    const savedAccount = () => Option.fromUndefinedOr(read<Account>(SHARE_ACCOUNT_KEY))
    const savedEnvironment = () => read<{ id: string; name: string }>(SHARE_ENVIRONMENT_KEY)

    // A stable identity for this installation. The relay uses it to recognise
    // re-registrations of the same machine instead of piling up duplicates.
    const deviceId = () => {
      const saved = read<string>(SHARE_DEVICE_ID_KEY)
      if (saved) return saved
      const generated = randomUUID()
      write(SHARE_DEVICE_ID_KEY, generated)
      return generated
    }

    const api = async (
      account: Account,
      pathname: string,
      init: { method?: string; body?: unknown; token?: string } = {},
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
          (parsed as { error?: string } | undefined)?.error ?? response.statusText ?? `HTTP ${response.status}`
        throw new Error(detail)
      }

      return parsed as Record<string, unknown>
    }

    const login = async (account: Account) => {
      const result = await api(account, "/api/auth/login", {
        method: "POST",
        body: { username: account.username, password: account.password, deviceLabel: "opencode-desktop" },
      })
      const token = (result as { token?: string }).token
      if (!token) throw new Error("Relay did not return a session token")

      return token
    }

    // The relay reports bad credentials as "invalid credentials". The renderer
    // translates this marker, so the UI can show a localized message.
    function describeError(error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
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
      return (created as { environment: { id: string; name: string } }).environment
    }

    const send = (message: unknown) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(message))
      return true
    }

    // V2: 发送二进制帧（响应体原始字节，无 base64）
    const sendBinary = (id: string, data: Buffer): boolean => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false
      if (socket.bufferedAmount > BACKPRESSURE_LIMIT) return false
      socket.send(packBinaryFrame(id, data), { binary: true })
      return true
    }

    // V2: 等待 WebSocket 排空（背压控制）
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
    // streams the response back over the tunnel.
    // V2 协议：响应用二进制帧发送（无 base64），元数据用文本帧。
    // V1 兼容：响应用 JSON+base64 文本帧。
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

      try {
        const response = await fetch(new URL(message.path, local.url), {
          method: message.method,
          headers,
          body: body && message.method !== "GET" && message.method !== "HEAD" ? (body as BodyInit) : undefined,
          signal: controller.signal,
          redirect: "manual",
        })

        const out: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          const lower = key.toLowerCase()
          if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(lower)) return
          out[key] = value
        })

        // V2: 响应头用文本帧（t:3），响应体用二进制帧
        send({ t: 3, id: message.id, status: response.status, headers: out })

        if (!response.body) {
          send({ t: 4, id: message.id })
          return
        }

        // Stream the body so server-sent events reach the client in real time.
        // V2: 用二进制帧发送原始字节（无 base64 编码），带背压控制
        const reader = response.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          // 背压控制：积压超限时等待 drain
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
    // V2: 二进制帧 = 请求体原始字节；文本帧 = JSON 元数据（V1 type 或 V2 t 字段）
    const v2PendingRequests = new Map<string, { method: string; path: string; headers: Record<string, string>; bodyChunks: Buffer[] }>()

    const handleMessage = (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // V2 二进制帧：请求体原始字节，累积到对应的 pending 请求
        const { id, data } = unpackBinaryFrame(raw)
        const entry = v2PendingRequests.get(id)
        if (entry) entry.bodyChunks.push(data)
        return
      }

      let message: Record<string, unknown>
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }

      const id = typeof message.id === "string" ? message.id : undefined
      if (!id) return

      // V2: 请求开始（t:1）— 初始化请求体缓冲
      if (message.t === 1) {
        v2PendingRequests.set(id, {
          method: String(message.method ?? "GET"),
          path: String(message.path ?? "/"),
          headers: (message.headers as Record<string, string>) ?? {},
          bodyChunks: [],
        })
        return
      }

      // V2: 请求体结束（t:2）— 合并分块，执行请求
      if (message.t === 2) {
        const entry = v2PendingRequests.get(id)
        if (!entry) return
        v2PendingRequests.delete(id)
        void handleRequest({
          id,
          method: entry.method,
          path: entry.path,
          headers: entry.headers,
          bodyBuffer: entry.bodyChunks.length > 0 ? Buffer.concat(entry.bodyChunks) : undefined,
        })
        return
      }

      // V1 兼容：旧协议消息（type 字段）
      switch (message.type) {
        case "req":
          void handleRequest({
            id,
            method: String(message.method ?? "GET"),
            path: String(message.path ?? "/"),
            headers: (message.headers as Record<string, string>) ?? {},
            bodyBuffer: typeof message.body === "string" ? Buffer.from(message.body, "base64") : undefined,
          })
          return
        case "ws-req":
          handleWebSocketRequest({
            id,
            path: String(message.path ?? "/"),
            headers: (message.headers as Record<string, string>) ?? {},
          })
          return
        case "ws-data": {
          const entry = sockets.get(id)
          if (!entry) return
          const data = Buffer.from(String(message.data ?? ""), "base64")
          entry.socket.send(data)
          return
        }
        case "ws-close": {
          const entry = sockets.get(id)
          if (!entry) return
          sockets.delete(id)
          entry.socket.close()
          return
        }
        default:
          return
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
