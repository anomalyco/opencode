import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { Context, Effect, Layer, Schema, Scope } from "effect"
import path from "path"
import { SessionID, MessageID } from "@/session/schema"
import { TelegramApi, type TelegramMessage } from "./api"

import type { GlobalEvent } from "@opencode-ai/sdk/v2"

const LINK_TTL_MS = 10 * 60_000
const POLL_ERROR_DELAY_MS = 2000
const REPLY_MAX_CHARS = 4000
const MIRROR_DEBOUNCE_MS = 1500

export type BridgeEventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void> | (() => void)
}

export interface Options {
  apiBaseUrl?: string
  pollTimeoutSeconds?: number
  botToken?: string
  linksPath?: string
  server?: {
    baseUrl: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: BridgeEventSource
  }
}

export interface LinkResult {
  url: string
  token: string
}

export interface ChatLink {
  chatId: number
  chatLabel: string
  sessionID: SessionID
  directory?: string
}

export interface Status {
  linked: ChatLink[]
}

export class LinkError extends Schema.TaggedErrorClass<LinkError>()("TelegramBridgeLinkError", {
  message: Schema.String,
}) {}

interface Interface {
  readonly link: (input?: { sessionID?: SessionID; botToken?: string }) => Effect.Effect<LinkResult, LinkError>
  readonly status: Effect.Effect<Status>
  readonly unlinkSession: (sessionID: SessionID) => Effect.Effect<void>
  readonly configure: (server: Options["server"]) => void
}

export class Settings extends Context.Service<Settings, Options>()("@opencode/TelegramBridge/Settings") {}
export class Service extends Context.Service<Service, Interface>()("@opencode/TelegramBridge") {}

function randomToken(bytes = 18): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Buffer.from(arr).toString("base64url")
}

function chatLabel(chat: { title?: string; username?: string; first_name?: string; last_name?: string }): string {
  return (chat.title ?? chat.username ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ")) || "unknown"
}

export function splitChunks(text: string, size = REPLY_MAX_CHARS): string[] {
  if (text.length <= size) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n\n", size)
    if (cut < size / 2) cut = rest.lastIndexOf("\n", size)
    if (cut < size / 2) cut = size
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, "")
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}

/** Escapes HTML and renders fenced code blocks + inline code as Telegram HTML entities. */
export function formatReplyHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const parts = escaped.split(/```(\w*)\n?([\s\S]*?)```/)
  let out = ""
  for (let i = 0; i < parts.length; i += 3) {
    out += (parts[i] ?? "").replace(/`([^`\n]+)`/g, "<code>$1</code>")
    const lang = parts[i + 1]
    if (lang === undefined) continue
    out += `<pre><code${lang ? ` class="language-${lang}"` : ""}>${parts[i + 2]?.trimEnd() ?? ""}</code></pre>`
  }
  return out
}

interface PendingLink {
  expiresAt: number
  sessionID?: SessionID
}

interface MirrorState {
  messageID: string
  parts: Map<string, string>
  telegramMessageId?: number
  timer?: ReturnType<typeof setTimeout>
  done: boolean
  sending?: Promise<void>
  pending?: boolean
}

const tokenFilePath = path.join(Global.Path.data, "telegram-token")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const opts = yield* Settings
    const scope = yield* Scope.Scope

    let serverConfig: Options["server"] | undefined = opts.server
    let api: TelegramApi | undefined
    let botUsername: string | undefined

    const clients = new Map<string | undefined, OpencodeClient>()
    function clientFor(directory?: string): OpencodeClient {
      const key = directory ?? ""
      let c = clients.get(key)
      if (!c) {
        const cfg =
          serverConfig ??
          opts.server ?? {
            baseUrl: "http://opencode.internal",
            fetch: (async (rin: RequestInfo | URL, rini?: RequestInit) => {
              const { Server } = await import("@/server/server")
              const { ServerAuth } = await import("@/server/auth")
              const req = new Request(rin, rini)
              const h = new Headers(req.headers)
              const auth = ServerAuth.header()
              if (auth) h.set("Authorization", auth)
              return Server.Default().app.fetch(new Request(req, { headers: h }))
            }) as typeof fetch,
          }
        c = createOpencodeClient({
          baseUrl: cfg.baseUrl,
          fetch: cfg.fetch,
          headers: cfg.headers,
          directory,
        })
        clients.set(key, c)
      }
      return c
    }

    const router = new Map<number, ChatLink>()
    const pendingLinks = new Map<string, PendingLink>()
    const mirrors = new Map<SessionID, MirrorState>()

    let started = false
    let linksLoaded = false
    let offset = 0

    const resolveToken = async (explicit?: string): Promise<string | undefined> => {
      if (explicit) return explicit
      if (opts.botToken) return opts.botToken
      if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN
      try {
        const saved = await Bun.file(tokenFilePath).text()
        if (saved.trim()) return saved.trim()
      } catch {}
      return undefined
    }

    const getApi = Effect.fn("TelegramBridge.getApi")(function* (token: string) {
      if (!api) api = new TelegramApi({ botToken: token, baseUrl: opts.apiBaseUrl })
      return api
    })

    const sendText = Effect.fn("TelegramBridge.sendText")(function* (chatId: number, text: string) {
      if (!api) return
      yield* Effect.tryPromise(() => api!.sendMessage(chatId, text, { parseMode: "HTML" })).pipe(
        Effect.catch(() => Effect.tryPromise(() => api!.sendMessage(chatId, text))),
        Effect.catch((cause) => Effect.logWarning("telegram send failed", { chatId, cause })),
      )
    })

    const buildText = (state: MirrorState) =>
      [...state.parts.values()].join("\n\n").trim() || (state.done ? "Done." : "…")

    const sendChunks = async (chatId: number, state: MirrorState) => {
      if (!api) return
      const chunks = splitChunks(buildText(state))
      for (let i = 0; i < chunks.length; i++) {
        const editExisting = i === 0 && state.telegramMessageId !== undefined
        try {
          if (editExisting) await api.editMessageText(chatId, state.telegramMessageId!, formatReplyHtml(chunks[i]), { parseMode: "HTML" })
          else {
            const sent = await api.sendMessage(chatId, formatReplyHtml(chunks[i]), { parseMode: "HTML" })
            state.telegramMessageId = sent.message_id
          }
        } catch {
          // Telegram rejects malformed HTML entities — fall back to plain text for this chunk.
          try {
            if (editExisting) await api.editMessageText(chatId, state.telegramMessageId!, chunks[i])
            else {
              const sent = await api.sendMessage(chatId, chunks[i])
              state.telegramMessageId = sent.message_id
            }
          } catch {}
        }
      }
    }

    const flushMirror = (sessionID: SessionID) => {
      const state = mirrors.get(sessionID)
      const link = [...router.values()].find((entry) => entry.sessionID === sessionID)
      if (!state || !link || !api) return
      delete state.timer
      // Serialize sends so overlapping debounces can't post duplicate chunks.
      if (state.sending) {
        state.pending = true
        return
      }
      state.sending = sendChunks(link.chatId, state).finally(() => {
        state.sending = undefined
        if (state.pending) {
          state.pending = false
          scheduleMirror(sessionID)
        }
      })
    }

    const scheduleMirror = (sessionID: SessionID) => {
      const state = mirrors.get(sessionID)
      if (!state) return
      if (state.timer) clearTimeout(state.timer)
      state.timer = setTimeout(() => flushMirror(sessionID), MIRROR_DEBOUNCE_MS)
    }

    const messageRole = new Map<string, "user" | "assistant">()
    const botSubmitted = new Set<string>()
    const userMirrored = new Set<string>()

    const onStreamEvent = (evt: { type: string; properties: any }) => {
      if (evt.type === "message.updated") {
        const info = evt.properties.info
        if (!info) return
        const sessionID = info.sessionID as SessionID
        if (![...router.values()].some((l) => l.sessionID === sessionID)) return
        messageRole.set(info.id, info.role)
        if (messageRole.size > 500) {
          messageRole.clear()
          userMirrored.clear()
        }
        if (info.role !== "assistant") return
        let state = mirrors.get(sessionID)
        if (!state || state.messageID !== info.id) {
          state = { messageID: info.id, parts: new Map(), done: false }
          mirrors.set(sessionID, state)
        }
        if (info.time?.completed) {
          state.done = true
          scheduleMirror(sessionID)
        }
        return
      }
      if (evt.type === "message.part.updated") {
        const part = evt.properties.part
        if (!part) return
        const sessionID = part.sessionID as SessionID
        const link = [...router.values()].find((l) => l.sessionID === sessionID)
        if (!link) return

        if (messageRole.get(part.messageID) === "user") {
          if (botSubmitted.has(part.messageID) || userMirrored.has(part.messageID)) return
          if (part.type === "text" && !part.synthetic && part.text.trim()) {
            userMirrored.add(part.messageID)
            void api?.sendMessage(link.chatId, `👤 ${part.text}`).catch(() => {})
          }
          return
        }

        const state = mirrors.get(sessionID)
        if (!state || state.messageID !== part.messageID) return
        if (part.type !== "text" || part.synthetic) return
        state.parts.set(part.id, part.text)
        scheduleMirror(sessionID)
      }
    }

    const startMirroring = Effect.gen(function* () {
      const injected = (serverConfig ?? opts.server)?.events
      if (injected) {
        yield* Effect.promise(async () => {
          await injected.subscribe((e) => {
            const p = (e as any)?.payload
            if (p && typeof p.type === "string" && p.properties) onStreamEvent(p)
          })
        })
        return
      }

      yield* Effect.forkIn(scope)(
        Effect.promise(async () => {
          while (started) {
            try {
              const client = clientFor(undefined)
              const events = await client.global.event()
              for await (const event of events.stream) {
                const payload = (event as any)?.payload ?? event
                onStreamEvent(payload as any)
              }
            } catch (err) {
              console.error("[telegram] mirror stream error", err)
              await Bun.sleep(POLL_ERROR_DELAY_MS)
            }
          }
        }),
      )
    })

    const startPolling = Effect.fn("TelegramBridge.startPolling")(function* () {
      if (started) return
      started = true
      yield* startMirroring
      const tick = Effect.gen(function* () {
        if (!api) return
        const updates = yield* Effect.tryPromise(() =>
          api!.getUpdates({ timeout: opts.pollTimeoutSeconds ?? 25, offset }),
        ).pipe(Effect.catch(() => Effect.succeed([])))
        for (const upd of updates) {
          offset = Math.max(offset, upd.update_id + 1)
          if (!upd.message) continue
          yield* handleMessage(upd.message).pipe(
            Effect.catchCause((cause) => Effect.logWarning("telegram handleMessage failed", { cause })),
          )
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("telegram polling failed", { cause }).pipe(
            Effect.andThen(() => Effect.sleep(POLL_ERROR_DELAY_MS)),
          ),
        ),
      )
      yield* Effect.forever(tick).pipe(Effect.forkIn(scope))
    })

    const handleMessage = Effect.fn("TelegramBridge.handleMessage")(function* (msg: TelegramMessage) {
      const text = msg.text?.trim() ?? ""
      const chatId = msg.chat.id
      yield* Effect.logInfo("Telegram message received", { chatId, text, from: msg.from?.username })

      if (text.startsWith("/start")) {
        const token = text.split(/\s+/)[1] ?? ""
        const pending = pendingLinks.get(token)
        if (!pending || Date.now() > pending.expiresAt) {
          pendingLinks.delete(token)
          yield* sendText(chatId, "Link token invalid or expired. Run /telegram in opencode again.")
          return
        }
        pendingLinks.delete(token)
        const label = chatLabel(msg.chat)
        let sessionID = pending.sessionID
        let directory: string | undefined
        if (!sessionID) {
          const res = yield* Effect.promise(() =>
            clientFor(undefined).session.create({ title: `telegram ${label}` }),
          ).pipe(Effect.catchCause((cause) => Effect.succeed({ error: cause, data: undefined })))
          if (res.error || !res.data?.id) {
            yield* sendText(chatId, `Could not create session: ${String(res.error ?? "unknown error")}`)
            return
          }
          sessionID = res.data.id as SessionID
          directory = res.data.directory
        }
        router.set(chatId, { chatId, chatLabel: label, sessionID, directory })
        yield* persistLinks()
        yield* Effect.logInfo("Telegram chat linked to session", { chatId, sessionID })
        yield* sendText(chatId, `Linked to opencode session ${sessionID}. Send /stop to interrupt generation.`)
        return
      }

      if (text === "/telegram") {
        if (!api || !botUsername) {
          yield* sendText(chatId, "Telegram bridge is still starting; try again shortly.")
          return
        }
        const { url } = yield* issueLink()
        yield* sendText(chatId, `Tap this link within 10 minutes to connect this chat to opencode:\n${url}`)
        return
      }

      if (text === "/stop") {
        const link = router.get(chatId)
        if (!link) return
        yield* Effect.promise(() => clientFor(link.directory).session.abort({ sessionID: link.sessionID })).pipe(
          Effect.ignore,
        )
        yield* sendText(chatId, "Stop signal sent.")
        return
      }

      if (text === "/status") {
        const link = router.get(chatId)
        if (!link) {
          yield* sendText(chatId, "This chat is not linked to any opencode session.")
          return
        }
        yield* sendText(chatId, `Currently linked to opencode session: ${link.sessionID}`)
        return
      }

      if (text === "/unlink") {
        const link = router.get(chatId)
        if (!link) {
          yield* sendText(chatId, "This chat is not linked to any opencode session.")
          return
        }
        router.delete(chatId)
        yield* persistLinks()
        yield* sendText(chatId, `Unlinked from opencode session ${link.sessionID}.`)
        return
      }

      const link = router.get(chatId)
      if (!link) {
        yield* Effect.logInfo("Telegram message received for unlinked chat", { chatId, text })
        return
      }
      if (text.length === 0) return

      if (!link.directory) {
        const res = yield* Effect.promise(() =>
          clientFor(undefined).session.get({ sessionID: link.sessionID }),
        ).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        if (res?.data?.directory) {
          link.directory = res.data.directory
          router.set(chatId, link)
        }
      }

      const messageID = MessageID.ascending()
      botSubmitted.add(messageID)
      if (botSubmitted.size > 500) botSubmitted.clear()

      const res = yield* Effect.promise(() =>
        clientFor(link.directory).session.promptAsync({
          sessionID: link.sessionID,
          messageID,
          parts: [{ type: "text", text }],
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          sendText(
            chatId,
            `⚠️ OpenCode prompt error for session <code>${link.sessionID}</code>: ${String(cause)}.`,
          ),
        ),
      )
      if (res && typeof res === "object" && "error" in res && (res as any).error) {
        yield* sendText(
          chatId,
          `⚠️ OpenCode prompt error for session <code>${link.sessionID}</code>: ${String((res as any).error?.message ?? (res as any).error)}.`,
        )
      }
    })

    const issueLink = Effect.fn("TelegramBridge.issueLink")(function* (sessionID?: SessionID) {
      const token = randomToken()
      pendingLinks.set(token, { expiresAt: Date.now() + LINK_TTL_MS, sessionID })
      return { url: `https://t.me/${botUsername}?start=${token}`, token }
    })

    const loadLinks = async (): Promise<ChatLink[]> => {
      if (!opts.linksPath) return []
      try {
        return await Bun.file(opts.linksPath).json()
      } catch {}
      return []
    }

    const ensureLinksLoaded = Effect.fn("TelegramBridge.ensureLinksLoaded")(function* () {
      if (linksLoaded) return
      linksLoaded = true
      for (const entry of yield* Effect.promise(loadLinks)) {
        router.set(entry.chatId, entry)
      }
    })

    const persistLinks = Effect.fn("TelegramBridge.persistLinks")(function* () {
      if (!opts.linksPath) return
      yield* Effect.promise(() => Bun.write(opts.linksPath!, JSON.stringify([...router.values()], null, 2), { createPath: true })).pipe(
        Effect.catch((cause) => Effect.logWarning("telegram links save failed", { cause })),
      )
    })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const state of mirrors.values()) {
          if (state.timer) clearTimeout(state.timer)
        }
      }),
    )

    yield* Effect.gen(function* () {
      yield* ensureLinksLoaded()
      if (!(serverConfig ?? opts.server)?.baseUrl) return
      const token = yield* Effect.promise(() => resolveToken())
      if (!token) return
      const currentApi = yield* getApi(token)
      if (!botUsername) {
        const me = yield* Effect.tryPromise(() => currentApi.getMe()).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (me) botUsername = me.username
      }
      if (botUsername) {
        yield* startPolling()
        yield* Effect.logInfo("Telegram bridge autostarted on boot", { botUsername })
      }
    }).pipe(Effect.ignore, Effect.forkIn(scope))

    return Service.of({
      configure: (server) => {
        if (server) {
          serverConfig = server
          clients.clear()
          router.clear()
          mirrors.clear()
          pendingLinks.clear()
          botSubmitted.clear()
          userMirrored.clear()
          messageRole.clear()
          linksLoaded = false
        }
      },
      link: (input) =>
        Effect.gen(function* () {
          yield* ensureLinksLoaded()
          const token = yield* Effect.promise(() => resolveToken(input?.botToken))
          if (!token) {
            return yield* new LinkError({ message: "No Telegram bot token configured. Save one first: opencode set-tg-token <token>." })
          }
          if (input?.botToken && input.botToken !== token) {
            yield* Effect.promise(async () => {
              await Bun.write(tokenFilePath, input.botToken!, { createPath: true })
              await import("fs/promises").then((fs) => fs.chmod(tokenFilePath, 0o600)).catch(() => {})
            }).pipe(Effect.ignore)
          }
          const currentApi = yield* getApi(token)
          if (!botUsername) {
            const me = yield* Effect.tryPromise(() => currentApi.getMe()).pipe(
              Effect.catch((cause) => Effect.fail(new LinkError({ message: `getMe failed: ${String(cause)}` }))),
            )
            botUsername = me.username
          }
          if (!botUsername) {
            return yield* new LinkError({ message: "Bot username is missing" })
          }
          yield* startPolling()
          return yield* issueLink(input?.sessionID)
        }),
      status: Effect.gen(function* () {
        yield* ensureLinksLoaded()
        return { linked: [...router.values()] }
      }),
      unlinkSession: (sessionID: SessionID) =>
        Effect.gen(function* () {
          yield* ensureLinksLoaded()
          for (const [chatId, entry] of router.entries()) {
            if (entry.sessionID === sessionID) {
              router.delete(chatId)
            }
          }
          yield* persistLinks()
        }),
    })
  }),
)

const envLayer = Layer.effect(
  Settings,
  Effect.sync(() => ({
    apiBaseUrl: process.env["OPENCODE_TELEGRAM_API_BASE_URL"],
    botToken: process.env["TELEGRAM_BOT_TOKEN"],
    linksPath: process.env["OPENCODE_TELEGRAM_LINKS_PATH"] ?? path.join(Global.Path.data, "telegram-links.json"),
  })),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer.pipe(Layer.provideMerge(envLayer)),
  deps: [],
})

export async function setupTelegramRemote(input?: {
  sessionID?: string
  server?: Options["server"]
}): Promise<{ token: string; url: string } | undefined> {
  try {
    const { AppRuntime } = await import("@/effect/app-runtime")
    const { SessionID } = await import("@/session/schema")

    const result = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const bridge = yield* Service
        if (input?.server) bridge.configure(input.server)
        const id = input?.sessionID ? SessionID.make(input.sessionID) : undefined
        return yield* bridge.link({ sessionID: id })
      }),
    )

    return result
  } catch (cause) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    await AppRuntime.runPromise(Effect.logWarning("telegram setup failed", { cause })).catch(() => {})
    return undefined
  }
}

export async function getTelegramStatus(server?: Options["server"]): Promise<{ linked: { chatId: number; chatLabel: string; sessionID: string }[] } | undefined> {
  try {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return await AppRuntime.runPromise(
      Effect.gen(function* () {
        const bridge = yield* Service
        if (server) bridge.configure(server)
        return yield* bridge.status
      }),
    )
  } catch (cause) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    await AppRuntime.runPromise(Effect.logWarning("telegram status check failed", { cause })).catch(() => {})
    return undefined
  }
}

export async function unlinkTelegramSession(sessionID: string, server?: Options["server"]): Promise<void> {
  try {
    const { AppRuntime } = await import("@/effect/app-runtime")
    const { SessionID } = await import("@/session/schema")
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const bridge = yield* Service
        if (server) bridge.configure(server)
        yield* bridge.unlinkSession(SessionID.make(sessionID))
      }),
    )
  } catch (cause) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    await AppRuntime.runPromise(Effect.logWarning("telegram unlink failed", { cause })).catch(() => {})
  }
}

export async function dispatchTelegramCommand(
  rawSubCommand: string,
  sessionID?: string,
  server?: Options["server"],
): Promise<{ text: string; kind: "assistant" | "error" }> {
  const sub = rawSubCommand.trim().split(/\s+/)[0]?.toLowerCase() ?? "link"
  if (sub === "link" || sub === "") {
    if (!sessionID) {
      return {
        text: "No active session to link. Start a session or run a prompt first.",
        kind: "error",
      }
    }
    const link = await setupTelegramRemote({ sessionID, server })
    if (link) {
      return {
        text: `**Telegram Remote Mode**\n\n[Open link in Telegram](${link.url})\n\n*(Valid for 10 minutes. Tap "Start" in Telegram to pair)*`,
        kind: "assistant",
      }
    }
    return {
      text: "Telegram bot token is not configured. Save one first: `opencode set-tg-token <token>`.",
      kind: "error",
    }
  }

  if (sub === "status") {
    const status = await getTelegramStatus(server)
    const linked = status?.linked.filter((x) => Boolean(sessionID) && x.sessionID === sessionID) ?? []
    if (linked.length > 0) {
      return {
        text: `Telegram bridge active. Linked to chat ${linked[0].chatId} (${linked[0].chatLabel ?? "chat"}).`,
        kind: "assistant",
      }
    }
    return {
      text: "Telegram bridge is ready, but not linked to this session. Run `/tg link` or `/telegram` to link.",
      kind: "assistant",
    }
  }

  if (sub === "unlink") {
    if (!sessionID) {
      return {
        text: "Telegram bridge is not linked to this session; nothing to unlink.",
        kind: "error",
      }
    }
    const status = await getTelegramStatus(server)
    const linked = status?.linked.filter((x) => x.sessionID === sessionID) ?? []
    if (linked.length === 0) {
      return {
        text: "Telegram bridge is not linked to this session; nothing to unlink.",
        kind: "error",
      }
    }
    await unlinkTelegramSession(sessionID, server)
    return {
      text: "Unlinked Telegram chat from this session.",
      kind: "assistant",
    }
  }

  return {
    text: "Usage: `/telegram` or `/tg link` | `/tg status` | `/tg unlink`",
    kind: "error",
  }
}

export * as TelegramBridge from "./bridge"
