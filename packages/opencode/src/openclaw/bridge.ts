import { Hono } from "hono"
import { stream, streamSSE } from "hono/streaming"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import os from "node:os"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { NamedError } from "@opencode-ai/util/error"

type Opts = {
  hostname: string
  port: number
  cors?: string[]
  gateway: {
    url: string
    token?: string
  }
}

type GwSession = {
  key?: string
  id?: string
  label?: string
  displayName?: string
  derivedTitle?: string
  updatedAt?: number | string
  createdAt?: number | string
}

type GwHistory = {
  messages?: GwMessage[]
}

type PromptBody = {
  messageID?: string
  parts?: Array<{ type?: string; text?: string }>
}

type GwMessage = {
  role?: string
  content?: unknown
  timestamp?: number | string
  ts?: number | string
  model?: string
  provider?: string
}

type GwResponse = {
  id?: string
  ok?: boolean
  payload?: unknown
  error?: {
    message?: string
  }
}

type GwEvent = {
  event?: string
  payload?: Record<string, unknown>
}

type Device = {
  deviceID: string
  publicKey: string
  privateKey: string
}

type Session = {
  id: string
  slug: string
  projectID: string
  directory: string
  title: string
  version: string
  time: {
    created: number
    updated: number
  }
}

type Message = {
  info: {
    id: string
    sessionID: string
    role: "user" | "assistant"
    time: {
      created: number
      completed?: number
    }
    agent: string
    model?: {
      providerID: string
      modelID: string
    }
    parentID?: string
    providerID?: string
    modelID?: string
    mode?: string
    path?: {
      cwd: string
      root: string
    }
    cost?: number
    tokens?: {
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
  }
  parts: Array<{
    id: string
    sessionID: string
    messageID: string
    type: "text"
    text: string
  }>
}

type Event = {
  directory: string
  payload: {
    type: string
    properties: Record<string, unknown>
  }
}

const projectID = "openclaw"
const version = "openclaw-bridge"
const directory = "/openclaw"
const log = Log.create({ service: "openclaw-bridge" })
const clientID = "gateway-client"

function now(input?: number | string) {
  if (typeof input === "number") return input
  if (typeof input === "string") {
    const n = Date.parse(input)
    if (!Number.isNaN(n)) return n
    const m = Number(input)
    if (!Number.isNaN(m)) return m
  }
  return Date.now()
}

function id(input: GwSession) {
  return input.key || input.id || crypto.randomUUID()
}

function text(input: unknown): string {
  if (typeof input === "string") return input
  if (Array.isArray(input)) return input.map(text).filter(Boolean).join("\n")
  if (!input || typeof input !== "object") return ""
  if ("text" in input && typeof input.text === "string") return input.text
  if ("content" in input) return text(input.content)
  return ""
}

function prompt(input: unknown) {
  if (!Array.isArray(input)) return ""
  return input
    .filter(
      (item): item is { type: "text"; text: string } =>
        !!item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n")
}

function sent(sessionID: string, body: PromptBody) {
  const messageID = body.messageID || Identifier.ascending("message")
  const text = prompt(body.parts)
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "claw",
      model: { providerID, modelID },
    },
    parts: [
      {
        id: `${messageID}-p0`,
        sessionID,
        messageID,
        type: "text",
        text,
      },
    ],
  } satisfies Message
}

function mergeHistory(history: Message[], optimistic: Message[]) {
  if (optimistic.length === 0) return history
  const rest = [...optimistic]
  const matched = history.map((item) => {
    if (item.info.role !== "user") return item
    const text = item.parts.map((part) => part.text).join("\n")
    const hit = rest.findIndex((candidate) => {
      if (candidate.info.role !== "user") return false
      const body = candidate.parts.map((part) => part.text).join("\n")
      if (body !== text) return false
      return Math.abs(candidate.info.time.created - item.info.time.created) < 60_000
    })
    if (hit === -1) return item
    const [candidate] = rest.splice(hit, 1)
    return {
      ...item,
      info: {
        ...item.info,
        id: candidate.info.id,
      },
      parts: candidate.parts,
    }
  })
  return [...matched, ...rest].sort((a, b) => a.info.time.created - b.info.time.created || cmp(a.info.id, b.info.id))
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

function session(input: GwSession): Session {
  const sid = id(input)
  return {
    id: sid,
    slug: sid,
    projectID,
    // Keep every OpenClaw session in the synthetic `/openclaw` workspace so the
    // existing sidebar/session UI can list them together like a built-in project.
    directory,
    title: input.label || input.displayName || input.derivedTitle || sid,
    version,
    time: {
      created: now(input.createdAt),
      updated: now(input.updatedAt),
    },
  }
}

const modelID = "claw"
const providerID = "openclaw"

const provider = {
  id: providerID,
  name: "OpenClaw",
  env: [],
  models: {
    [modelID]: {
      id: modelID,
      name: "Claw",
      release_date: "2026-01-01",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      interleaved: false,
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      cost: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
      },
      limit: {
        context: 200000,
        output: 8000,
      },
      status: "active",
      options: {},
      headers: {},
      provider: {
        api: "openai-compatible",
        npm: "@ai-sdk/openai-compatible",
      },
    },
  },
} as const

const agent = {
  name: "claw",
  description: "OpenClaw bridge agent",
  mode: "primary",
  permission: {},
  model: {
    providerID,
    modelID,
  },
  options: {},
} as const

const ed25519Prefix = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])

function base64url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function raw(key: string) {
  const der = createPublicKey(key).export({ format: "der", type: "spki" })
  const buf = Buffer.isBuffer(der) ? der : Buffer.from(der)
  if (buf.subarray(0, ed25519Prefix.length).equals(ed25519Prefix)) return buf.subarray(ed25519Prefix.length)
  return buf
}

async function device() {
  const file = path.join(os.homedir(), ".openclaw", "identity", "device.json")
  const saved = (await Bun.file(file)
    .json()
    .catch(() => undefined)) as
    | {
        deviceId?: string
        publicKeyPem?: string
        privateKeyPem?: string
      }
    | undefined
  if (saved?.deviceId && saved.publicKeyPem && saved.privateKeyPem) {
    log.debug("loaded openclaw device identity", { file, deviceID: saved.deviceId })
    return {
      deviceID: saved.deviceId,
      publicKey: saved.publicKeyPem,
      privateKey: saved.privateKeyPem,
    } satisfies Device
  }
  const pair = generateKeyPairSync("ed25519")
  const publicKey = pair.publicKey.export({ format: "pem", type: "spki" }).toString()
  const privateKey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  const deviceID = createHash("sha256").update(raw(publicKey)).digest("hex")
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    `${JSON.stringify(
      {
        version: 1,
        deviceId: deviceID,
        publicKeyPem: publicKey,
        privateKeyPem: privateKey,
        createdAtMs: Date.now(),
      },
      null,
      2,
    )}\n`,
  )
  log.info("generated openclaw device identity", { file, deviceID })
  return { deviceID, publicKey, privateKey } satisfies Device
}

class GwClient {
  private ws?: WebSocket
  private ready?: Promise<void>
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private events = new Set<(event: GwEvent) => void>()

  constructor(
    private url: string,
    private token?: string,
  ) {}

  private socket() {
    try {
      const url = new URL(this.url)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      if (!url.pathname || url.pathname === "/") return url.toString()
      return url.toString()
    } catch {
      if (this.url.startsWith("ws://") || this.url.startsWith("wss://")) return this.url
      if (this.url.startsWith("https://")) return this.url.replace("https://", "wss://")
      if (this.url.startsWith("http://")) return this.url.replace("http://", "ws://")
      return `ws://${this.url}`
    }
  }

  private async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.ready) return this.ready
    log.info("connecting to openclaw gateway", { url: this.socket(), hasToken: !!this.token })
    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.socket())
      let done = false
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        fn()
      }
      ws.onmessage = (event) => {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>
        if (typeof data.event === "string") {
          const evt = data as GwEvent
          for (const fn of this.events) fn(evt)
        }
        if (data.event === "connect.challenge") {
          log.debug("received openclaw connect.challenge")
          const nonce =
            typeof data.payload === "object" && data.payload && "nonce" in data.payload ? data.payload.nonce : ""
          const id = crypto.randomUUID()
          const connected = (value: unknown) => {
            const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
            const status = typeof payload?.status === "string" ? payload.status : undefined
            if (status === "accepted") return
            this.ws = ws
            finish(resolve)
          }
          this.pending.set(id, {
            resolve(value) {
              connected(value)
            },
            reject(error) {
              finish(() => reject(error))
            },
          })
          void device()
            .then((item) => {
              const signedAt = Date.now()
              const scopes = "operator.admin"
              const payload = [
                "v2",
                item.deviceID,
                clientID,
                "backend",
                "operator",
                scopes,
                `${signedAt}`,
                this.token ?? "",
                String(nonce ?? ""),
              ].join("|")
              const signature = base64url(sign(null, Buffer.from(payload), createPrivateKey(item.privateKey)))
              log.debug("sending openclaw connect", { deviceID: item.deviceID, hasToken: !!this.token })
              ws.send(
                JSON.stringify({
                  type: "req",
                  id,
                  method: "connect",
                  params: {
                    minProtocol: 3,
                    maxProtocol: 3,
                    client: {
                      id: clientID,
                      displayName: "OpenCode",
                      version: Installation.VERSION,
                      platform: "bun",
                      mode: "backend",
                    },
                    auth: this.token ? { token: this.token } : undefined,
                    device: {
                      id: item.deviceID,
                      publicKey: base64url(raw(item.publicKey)),
                      signature,
                      signedAt,
                      nonce,
                    },
                    role: "operator",
                    scopes: ["operator.admin"],
                    caps: [],
                    permissions: {},
                  },
                }),
              )
            })
            .catch((err) => {
              log.error("failed to prepare openclaw device identity", { error: err })
              this.pending.delete(id)
              finish(() => reject(err instanceof Error ? err : new Error(String(err))))
            })
          return
        }
        if (typeof data.id === "string") {
          const hit = this.pending.get(data.id)
          if (hit) {
            const res = data as GwResponse
            if (res.ok) {
              const payload =
                res.payload && typeof res.payload === "object" ? (res.payload as Record<string, unknown>) : undefined
              const status = typeof payload?.status === "string" ? payload.status : undefined
              if (status !== "accepted") this.pending.delete(data.id)
              log.debug("openclaw response ok", { id: data.id, status: status ?? "completed" })
              hit.resolve(res.payload)
            } else {
              this.pending.delete(data.id)
              log.error("openclaw response error", {
                id: data.id,
                message: res.error?.message || "Gateway request failed",
              })
              hit.reject(new Error(res.error?.message || "Gateway request failed"))
            }
            return
          }
        }
      }
      ws.onopen = () => undefined
      ws.onerror = () => {
        log.error("openclaw websocket error")
        finish(() => reject(new Error("Failed to connect to OpenClaw gateway")))
      }
      ws.onclose = () => {
        log.warn("openclaw websocket closed")
        this.ws = undefined
        this.ready = undefined
        for (const [id, item] of this.pending) {
          this.pending.delete(id)
          item.reject(new Error("Gateway connection closed"))
        }
        if (!done) finish(() => reject(new Error("Gateway connection closed")))
      }
      setTimeout(() => {
        log.error("openclaw gateway connect timeout")
        finish(() => reject(new Error("Gateway connect timeout")))
      }, 10_000)
    }).finally(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) this.ready = undefined
    })
    return this.ready
  }

  async request(method: string, params?: unknown) {
    await this.connect()
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("Gateway not connected")
    log.debug("openclaw request", { method, params })
    const id = crypto.randomUUID()
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        const hit = this.pending.get(id)
        if (!hit) return
        this.pending.delete(id)
        log.error("openclaw request timeout", { method })
        reject(new Error(`Gateway request timeout: ${method}`))
      }, 30_000)
    })
    this.ws.send(
      JSON.stringify({
        type: "req",
        id,
        method,
        params: params ?? {},
      }),
    )
    return result
  }

  on(fn: (event: GwEvent) => void) {
    this.events.add(fn)
    return () => this.events.delete(fn)
  }
}

class Events {
  private list = new Set<(event: Event) => void>()

  on(fn: (event: Event) => void) {
    this.list.add(fn)
    return () => this.list.delete(fn)
  }

  emit(event: Event) {
    for (const fn of this.list) fn(event)
  }
}

function msg(sessionID: string, item: GwMessage, index: number): Message | undefined {
  const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : undefined
  if (!role) return
  const messageID = `${sessionID}-m${index}`
  const body = text(item.content)
  return {
    info:
      role === "user"
        ? {
            id: messageID,
            sessionID,
            role,
            time: { created: now(item.timestamp ?? item.ts) },
            agent: "claw",
            model:
              item.provider && item.model
                ? { providerID: item.provider, modelID: item.model }
                : { providerID, modelID },
          }
        : {
            id: messageID,
            sessionID,
            role,
            time: { created: now(item.timestamp ?? item.ts), completed: now(item.timestamp ?? item.ts) },
            parentID: `${sessionID}-m${Math.max(0, index - 1)}`,
            providerID: item.provider || providerID,
            modelID: item.model || modelID,
            mode: "default",
            agent: "claw",
            path: { cwd: `${directory}/${sessionID}`, root: directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
    parts: [
      {
        id: `${messageID}-p0`,
        sessionID,
        messageID,
        type: "text",
        text: body,
      },
    ],
  }
}

async function sessions(client: GwClient) {
  const res = (await client.request("sessions.list", {
    limit: 50,
    includeDerivedTitles: true,
    includeLastMessage: true,
  })) as { sessions?: unknown[] } | unknown[]
  const list = Array.isArray(res) ? res : Array.isArray(res.sessions) ? res.sessions : []
  log.debug("openclaw sessions loaded", { count: list.length })
  return list.map((item: unknown) => session(item as GwSession))
}

async function history(client: GwClient, sessionID: string) {
  const res = (await client.request("chat.history", { sessionKey: sessionID, limit: 200 })) as GwHistory | unknown[]
  const list = Array.isArray(res) ? res : Array.isArray(res.messages) ? res.messages : []
  const mapped = list
    .map((item: unknown, index: number) => msg(sessionID, item as GwMessage, index))
    .filter((item: Message | undefined): item is Message => !!item)
  log.debug("openclaw history loaded", {
    sessionID,
    count: list.length,
    mapped: mapped.map((item) => ({ id: item.info.id, role: item.info.role, created: item.info.time.created })),
  })
  return mapped
}

async function waitHistory(client: GwClient, sessionID: string, started: number) {
  for (let i = 0; i < 90; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const list = await history(client, sessionID).catch(() => [])
    const item = [...list].reverse().find((item) => item.info.role === "assistant" && item.info.time.created >= started)
    log.debug("openclaw waitHistory poll", {
      sessionID,
      started,
      attempt: i + 1,
      total: list.length,
      hit: item ? { id: item.info.id, created: item.info.time.created } : undefined,
    })
    if (item) return item
  }
  log.warn("openclaw waitHistory exhausted", { sessionID, started })
}

export namespace OpenClawBridge {
  export function createApp(opts: Opts) {
    const app = new Hono()
    const gw = new GwClient(opts.gateway.url, opts.gateway.token)
    const events = new Events()
    const runs = new Map<
      string,
      { sessionID: string; messageID: string; partID: string; parentID: string; text: string }
    >()
    // Cache the just-submitted user turn until gateway history catches up, so
    // OpenCode can render the turn immediately in a new OpenClaw conversation.
    const sentMap = new Map<string, Message[]>()

    const emitStatus = (sessionID: string, type: "busy" | "idle") => {
      events.emit({
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID, status: { type } },
        },
      })
    }

    const emitPart = (runID: string, payload: Record<string, unknown>) => {
      const hit = runs.get(runID)
      if (!hit) return
      const message =
        payload.message && typeof payload.message === "object"
          ? (payload.message as Record<string, unknown>)
          : undefined
      const body = text(message?.content)
      if (!body) return
      if (!hit.text) {
        const info = {
          id: hit.messageID,
          sessionID: hit.sessionID,
          role: "assistant",
          time: { created: Date.now() },
          parentID: hit.parentID,
          providerID: String(message?.provider || providerID),
          modelID: String(message?.model || modelID),
          mode: "default",
          agent: "claw",
          path: { cwd: `${directory}/${hit.sessionID}`, root: directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
        const part = {
          id: hit.partID,
          sessionID: hit.sessionID,
          messageID: hit.messageID,
          type: "text",
          text: "",
        }
        events.emit({ directory, payload: { type: "message.updated", properties: { info } } })
        events.emit({ directory, payload: { type: "message.part.updated", properties: { part } } })
      }
      const delta = body.startsWith(hit.text) ? body.slice(hit.text.length) : body
      hit.text = body
      if (!delta) return
      log.debug("openclaw emit message.part.delta", {
        runID,
        sessionID: hit.sessionID,
        messageID: hit.messageID,
        delta,
      })
      events.emit({
        directory,
        payload: {
          type: "message.part.delta",
          properties: {
            sessionID: hit.sessionID,
            messageID: hit.messageID,
            partID: hit.partID,
            field: "text",
            delta,
          },
        },
      })
    }

    const finish = async (runID: string, payload: Record<string, unknown>, state: "final" | "aborted" | "error") => {
      const hit = runs.get(runID)
      if (!hit) return
      log.info("openclaw run finished", {
        runID,
        sessionID: hit.sessionID,
        state,
        text: hit.text,
        parentID: hit.parentID,
      })
      if (state === "error") {
        events.emit({
          directory,
          payload: {
            type: "session.error",
            properties: {
              sessionID: hit.sessionID,
              error: {
                name: "UnknownError",
                data: { message: String(payload.errorMessage || "OpenClaw run failed") },
              },
            },
          },
        })
      }
      if (state === "final" || (state === "aborted" && hit.text)) {
        const list = await sessions(gw).catch(() => [])
        const info = list.find((item: Session) => item.id === hit.sessionID)
        if (info) {
          log.debug("openclaw emit session.updated", { sessionID: info.id, title: info.title })
          events.emit({
            directory,
            payload: {
              type: "session.updated",
              properties: { info },
            },
          })
        }
      }
      sentMap.set(
        hit.sessionID,
        (sentMap.get(hit.sessionID) ?? []).filter((item) => item.info.id !== hit.parentID),
      )
      emitStatus(hit.sessionID, "idle")
      runs.delete(runID)
    }

    gw.on((event) => {
      if (event.event !== "chat") return
      const payload = event.payload ?? {}
      const runID = typeof payload.runId === "string" ? payload.runId : undefined
      if (!runID) return
      const state = typeof payload.state === "string" ? payload.state : undefined
      log.debug("openclaw gw chat event", { runID, state, payload })
      if (state === "delta") {
        emitPart(runID, payload)
        return
      }
      if (state === "final") {
        emitPart(runID, payload)
        void finish(runID, payload, "final")
        return
      }
      if (state === "aborted") {
        void finish(runID, payload, "aborted")
        return
      }
      if (state === "error") {
        void finish(runID, payload, "error")
      }
    })

    return app
      .onError((err, c) => {
        const message = err instanceof Error ? err.message : String(err)
        log.error("openclaw bridge request failed", { error: message })
        return c.json(new NamedError.Unknown({ message }).toObject(), { status: 500 })
      })
      .use((c, next) => {
        const password = process.env.OPENCODE_SERVER_PASSWORD
        if (!password || c.req.method === "OPTIONS") return next()
        return basicAuth({ username: process.env.OPENCODE_SERVER_USERNAME ?? "opencode", password })(c, next)
      })
      .use(
        cors({
          origin(input) {
            if (!input) return
            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (
              input === "tauri://localhost" ||
              input === "http://tauri.localhost" ||
              input === "https://tauri.localhost"
            )
              return input
            if (opts.cors?.includes(input)) return input
            return
          },
        }),
      )
      .get("/global/health", async (c) => {
        try {
          await sessions(gw)
          return c.json({ healthy: true, version: Installation.VERSION })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error("openclaw health failed", { error: message })
          return c.json(new NamedError.Unknown({ message }).toObject(), { status: 503 })
        }
      })
      .get("/global/config", (c) => c.json({ model: `${providerID}/${modelID}` }))
      .patch("/global/config", async (c) =>
        c.json(await c.req.json().catch(() => ({ model: `${providerID}/${modelID}` }))),
      )
      .post("/global/dispose", (c) => c.json(true))
      .get("/global/event", async (c) => {
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({ data: JSON.stringify({ payload: { type: "server.connected", properties: {} } }) })
          const off = events.on((event) => {
            void stream.writeSSE({ data: JSON.stringify(event) })
          })
          const timer = setInterval(() => {
            stream.writeSSE({ data: JSON.stringify({ payload: { type: "server.heartbeat", properties: {} } }) })
          }, 10_000)
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              off()
              clearInterval(timer)
              resolve()
            })
          })
        })
      })
      .get("/path", (c) =>
        c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: directory,
          directory,
        }),
      )
      .get("/project", (c) =>
        c.json([
          {
            id: projectID,
            worktree: directory,
            name: "OpenClaw",
            time: { created: Date.now(), updated: Date.now() },
            sandboxes: [],
          },
        ]),
      )
      .get("/project/current", (c) =>
        c.json({
          id: projectID,
          worktree: directory,
          name: "OpenClaw",
          time: { created: Date.now(), updated: Date.now() },
          sandboxes: [],
        }),
      )
      .get("/provider", (c) =>
        c.json({
          all: [provider],
          default: { [providerID]: `${providerID}/${modelID}` },
          connected: [providerID],
        }),
      )
      .get("/provider/auth", (c) => c.json({}))
      .get("/config", (c) => c.json({}))
      .get("/command", (c) => c.json([]))
      .get("/agent", (c) => c.json([agent]))
      .get("/skill", (c) => c.json([]))
      .get("/mcp", (c) => c.json({}))
      .get("/lsp", (c) => c.json([]))
      .get("/vcs", (c) => c.json({ branch: "openclaw" }))
      .get("/permission", (c) => c.json([]))
      .get("/question", (c) => c.json([]))
      .get("/session/status", (c) => c.json({}))
      .get("/session", async (c) => c.json(await sessions(gw)))
      .post("/session", async (c) => {
        const body = await c.req.json().catch(() => ({}))
        const sid = body?.id || crypto.randomUUID()
        return c.json({
          id: sid,
          slug: sid,
          projectID,
          directory,
          title: body?.title || sid,
          version,
          time: { created: Date.now(), updated: Date.now() },
        })
      })
      .get("/session/:sessionID", async (c) => {
        const sessionID = c.req.param("sessionID")
        const list = await sessions(gw)
        const item = list.find((item: Session) => item.id === sessionID)
        if (item) return c.json(item)
        return c.json(
          {
            id: sessionID,
            slug: sessionID,
            projectID,
            directory,
            title: sessionID,
            version,
            time: { created: Date.now(), updated: Date.now() },
          },
          200,
        )
      })
      .get("/session/:sessionID/todo", (c) => c.json([]))
      .get("/session/:sessionID/children", (c) => c.json([]))
      .get("/session/:sessionID/message", async (c) => {
        const sessionID = c.req.param("sessionID")
        const merged = mergeHistory(await history(gw, sessionID), sentMap.get(sessionID) ?? [])
        log.debug("openclaw session messages response", {
          sessionID,
          count: merged.length,
          items: merged.map((item) => ({ id: item.info.id, role: item.info.role, created: item.info.time.created })),
        })
        return c.json(merged)
      })
      .post("/session/:sessionID/prompt_async", async (c) => {
        const sessionID = c.req.param("sessionID")
        const body = (await c.req.json().catch(() => ({}))) as PromptBody
        const message = prompt(body?.parts)
        const started = Date.now()
        const optimistic = sent(sessionID, body)
        sentMap.set(sessionID, [...(sentMap.get(sessionID) ?? []), optimistic])
        log.info("openclaw prompt_async", { sessionID, message })
        void gw
          .request("chat.send", {
            sessionKey: sessionID,
            message,
            deliver: false,
            idempotencyKey: crypto.randomUUID(),
          })
          .then((res) => {
            const runID =
              typeof (res as Record<string, unknown>)?.runId === "string"
                ? String((res as Record<string, unknown>).runId)
                : crypto.randomUUID()
            runs.set(runID, {
              sessionID,
              messageID: Identifier.ascending("message"),
              partID: Identifier.ascending("part"),
              parentID: optimistic.info.id,
              text: "",
            })
            log.debug("openclaw prompt_async accepted", { sessionID, runID })
            emitStatus(sessionID, "busy")
            void waitHistory(gw, sessionID, started)
              .then((item) => {
                if (!item) return
                log.debug("openclaw prompt_async history hit", {
                  sessionID,
                  messageID: item.info.id,
                  created: item.info.time.created,
                })
                events.emit({
                  directory,
                  payload: {
                    type: "message.updated",
                    properties: { info: item.info },
                  },
                })
                for (const part of item.parts) {
                  log.debug("openclaw emit message.part.updated", {
                    sessionID,
                    messageID: part.messageID,
                    partID: part.id,
                    text: part.text,
                  })
                  events.emit({
                    directory,
                    payload: {
                      type: "message.part.updated",
                      properties: { part },
                    },
                  })
                }
                emitStatus(sessionID, "idle")
              })
              .catch(() => emitStatus(sessionID, "idle"))
          })
          .catch(() => {
            log.error("openclaw prompt_async failed", { sessionID })
            events.emit({
              directory,
              payload: {
                type: "session.error",
                properties: {
                  sessionID,
                  error: { name: "UnknownError", data: { message: "OpenClaw send failed" } },
                },
              },
            })
            emitStatus(sessionID, "idle")
          })
        return c.body(null, 204)
      })
      .post("/session/:sessionID/message", async (c) => {
        const sessionID = c.req.param("sessionID")
        const body = (await c.req.json().catch(() => ({}))) as PromptBody
        const message = prompt(body?.parts)
        const optimistic = sent(sessionID, body)
        sentMap.set(sessionID, [...(sentMap.get(sessionID) ?? []), optimistic])
        log.info("openclaw message", { sessionID, message })
        const started = Date.now()
        const res = await gw.request("chat.send", {
          sessionKey: sessionID,
          message,
          deliver: false,
          idempotencyKey: crypto.randomUUID(),
        })
        const runID =
          typeof (res as Record<string, unknown>)?.runId === "string"
            ? String((res as Record<string, unknown>).runId)
            : crypto.randomUUID()
        runs.set(runID, {
          sessionID,
          messageID: Identifier.ascending("message"),
          partID: Identifier.ascending("part"),
          parentID: optimistic.info.id,
          text: "",
        })
        log.debug("openclaw message accepted", { sessionID, runID })
        emitStatus(sessionID, "busy")
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (stream) => {
          const item = await waitHistory(gw, sessionID, started)
          if (!item) log.warn("openclaw message completed without assistant reply", { sessionID })
          if (item) {
            log.debug("openclaw message stream response", {
              sessionID,
              messageID: item.info.id,
              role: item.info.role,
              parts: item.parts.map((part) => ({ id: part.id, text: part.text })),
            })
          }
          for (let i = 0; i < 45; i++) {
            await new Promise((resolve) => setTimeout(resolve, 200))
            if (runs.has(runID)) continue
            break
          }
          stream.write(JSON.stringify(item ?? null))
        })
      })
  }

  export function listen(opts: Opts) {
    const app = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)
    return server
  }
}
