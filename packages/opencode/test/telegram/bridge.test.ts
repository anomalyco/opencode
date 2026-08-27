import { beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs"
import path from "path"
import type { TelegramMessage, TelegramUpdate } from "@/telegram/api"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"
import { TelegramBridge } from "@/telegram/bridge"

const BOT_USERNAME = "test_bot"

interface SentMessage {
  chat_id: number
  text: string
}

function startBotApi() {
  const sent: SentMessage[] = []
  let queue: TelegramUpdate[][] = []
  let updateID = 0
  let messageID = 100

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      const method = url.pathname.split("/").at(-1)
      if (method === "getMe") {
        return Response.json({ ok: true, result: { id: 1, username: BOT_USERNAME } })
      }
      if (method === "getUpdates") {
        const batch = queue.shift()
        if (batch) return Response.json({ ok: true, result: batch })
        await Bun.sleep(25)
        return Response.json({ ok: true, result: [] })
      }
      if (method === "sendMessage") {
        const payload = (await req.json()) as SentMessage
        sent.push(payload)
        return Response.json({ ok: true, result: { message_id: ++messageID } })
      }
      if (method === "editMessageText") {
        const payload = (await req.json()) as SentMessage
        sent.push(payload)
        return Response.json({ ok: true, result: { message_id: messageID } })
      }
      return Response.json({ ok: false }, { status: 400 })
    },
  })

  return {
    sent,
    server,
    push(message: Partial<TelegramMessage>) {
      updateID += 1
      queue.push([
        {
          update_id: updateID,
          message: {
            message_id: updateID,
            chat: { id: 1, type: "private" },
            ...message,
          } as TelegramMessage,
        },
      ])
    },
    reset() {
      sent.length = 0
      queue = []
    },
    stop: () => server.stop(true),
  }
}

interface RecordedPrompt {
  sessionID: SessionID
  text: string
}

function startFakeServer() {
  const prompts: RecordedPrompt[] = []
  const cancelled: SessionID[] = []
  const createdSessions: SessionID[] = []
  let sessionCounter = 0
  const clients = new Set<ReadableStreamDefaultController>()

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      if (url.pathname === "/event" || url.pathname === "/global/event") {
        const body = new ReadableStream({
          start(controller) {
            clients.add(controller)
          },
          cancel(controller) {
            clients.delete(controller)
          },
        })
        return new Response(body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        })
      }
      if (url.pathname === "/session" && req.method === "POST") {
        if (fakeServer.shouldFailCreate) {
          return Response.json({ error: { message: "boom" } }, { status: 500 })
        }
        sessionCounter += 1
        const id = SessionID.make(`ses-telegram-test-${sessionCounter}`)
        createdSessions.push(id)
        const body = (await req.json()) as { title?: string }
        return Response.json({ id, title: body.title, directory: "/tmp" })
      }
      if (url.pathname.startsWith("/session/") && req.method === "GET") {
        const id = url.pathname.split("/")[2] as SessionID
        return Response.json({ id, title: "test", directory: "/tmp" })
      }
      if (url.pathname.includes("/prompt_async") && req.method === "POST") {
        if (fakeServer.shouldFailPrompt) {
          fakeServer.shouldFailPrompt = false
          return Response.json({ error: "prompt failed" }, { status: 500 })
        }
        const parts = url.pathname.split("/")
        const sessionID = parts[2] as SessionID
        const body = (await req.json()) as { parts: { type: string; text: string }[] }
        const text = body.parts.find((p) => p.type === "text")?.text ?? ""
        prompts.push({ sessionID, text })
        return Response.json({ status: "ok" })
      }
      if (url.pathname.includes("/abort") && req.method === "POST") {
        const parts = url.pathname.split("/")
        const sessionID = parts[2] as SessionID
        cancelled.push(sessionID)
        return Response.json({ status: "ok" })
      }
      return Response.json({ ok: false }, { status: 404 })
    },
  })

  function emitSSE(event: { type: string; properties: any }) {
    const data = `data: ${JSON.stringify({ payload: event })}\n\n`
    const enc = new TextEncoder().encode(data)
    for (const client of clients) {
      try {
        client.enqueue(enc)
      } catch {}
    }
  }

  return {
    server,
    url: `http://localhost:${server.port}`,
    prompts,
    cancelled,
    createdSessions,
    shouldFailCreate: false,
    shouldFailPrompt: false,
    emitSSE,
    reset() {
      prompts.length = 0
      cancelled.length = 0
      createdSessions.length = 0
      sessionCounter = 0
      this.shouldFailCreate = false
      this.shouldFailPrompt = false
    },
    stop() {
      server.stop(true)
    },
  }
}

const bot = startBotApi()
const fakeServer = startFakeServer()
const linksDir = path.join("/tmp", `opencode-telegram-test-${process.pid}`)
const linksPath = path.join(linksDir, "links.json")
fs.mkdirSync(linksDir, { recursive: true })
process.env["OPENCODE_TELEGRAM_API_BASE_URL"] = `http://localhost:${bot.server.port}`
process.env["OPENCODE_TELEGRAM_LINKS_PATH"] = linksPath

let messageCounter = 0

function publishReply(sessionID: SessionID, replyText = "assistant reply") {
  messageCounter += 1
  const messageID = `msg_telegram_${messageCounter}`
  fakeServer.emitSSE({
    type: "message.updated",
    properties: {
      info: {
        id: messageID,
        role: "assistant",
        sessionID,
        time: {},
      },
    },
  })
  fakeServer.emitSSE({
    type: "message.part.updated",
    properties: {
      part: {
        id: `prt_telegram_${messageCounter}`,
        sessionID,
        messageID,
        type: "text",
        text: replyText,
      },
    },
  })
  fakeServer.emitSSE({
    type: "message.updated",
    properties: {
      info: {
        id: messageID,
        role: "assistant",
        sessionID,
        time: { completed: Date.now() },
      },
    },
  })
}

const env = LayerNode.compile(TelegramBridge.node, [])
const it = testEffect(env)

beforeEach(() => {
  bot.reset()
  fakeServer.reset()
  fs.rmSync(linksPath, { force: true })
})

async function waitUntil(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${message}`)
    await Bun.sleep(10)
  }
}

describe("TelegramBridge", () => {
  it.live("link returns a t.me URL and starts empty", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      expect(link.url).toContain(`https://t.me/${BOT_USERNAME}?start=`)
      const status = yield* bridge.status
      expect(status.linked).toEqual([])
    }),
  )

  it.live("links a chat via /start token", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 111, type: "private", first_name: "Ada" } })

      yield* Effect.promise(() => waitUntil(() => bot.sent.length > 0, "link confirmation"))

      expect(bot.sent[0]?.chat_id).toBe(111)
      expect(bot.sent[0]?.text).toContain("Linked to opencode session")
      expect(fakeServer.createdSessions).toEqual([SessionID.make("ses-telegram-test-1")])

      const status = yield* bridge.status
      expect(status.linked).toEqual([{ chatId: 111, chatLabel: "Ada", sessionID: fakeServer.createdSessions[0], directory: "/tmp" }])
    }),
  )

  it.live("links an existing sessionID when specified in link()", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const customID = SessionID.make("ses-telegram-custom-999")
      const link = yield* bridge.link({ sessionID: customID, botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 333, type: "private", first_name: "Bob" } })

      yield* Effect.promise(() => waitUntil(() => bot.sent.length > 0, "link confirmation"))

      expect(bot.sent[0]?.chat_id).toBe(333)
      expect(bot.sent[0]?.text).toContain(`Linked to opencode session ${customID}`)
      expect(fakeServer.createdSessions).toEqual([])

      const status = yield* bridge.status
      expect(status.linked).toEqual([{ chatId: 333, chatLabel: "Bob", sessionID: customID }])
    }),
  )

  it.live("handles /status and /unlink commands", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const customID = SessionID.make("ses-telegram-custom-888")
      const link = yield* bridge.link({ sessionID: customID, botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 444, type: "private", first_name: "Carol" } })
      yield* Effect.promise(() => waitUntil(() => bot.sent.length > 0, "linked"))

      bot.push({ text: "/status", chat: { id: 444, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => Boolean(bot.sent.at(-1)?.text.includes("Currently linked")), "status reply"))
      expect(bot.sent.at(-1)?.text).toContain(customID)

      bot.push({ text: "/unlink", chat: { id: 444, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => Boolean(bot.sent.at(-1)?.text.includes("Unlinked from")), "unlink reply"))

      const status = yield* bridge.status
      expect(status.linked).toEqual([])
    }),
  )

  it.live("rejects an invalid link token", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: "/start wrong-token", chat: { id: 222, type: "private" } })

      yield* Effect.promise(() => waitUntil(() => bot.sent.length > 0, "rejection message"))

      expect(bot.sent[0]?.text).toContain("invalid or expired")
      expect(fakeServer.createdSessions).toEqual([])
    }),
  )

  it.live("routes chat messages into session prompts and mirrors replies", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 111, type: "private", first_name: "Ada" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked session"))
      const linkedSession = fakeServer.createdSessions[0]

      bot.push({ text: "hello opencode", chat: { id: 111, type: "private" } })
      yield* Effect.promise(() =>
        waitUntil(() => fakeServer.prompts.some((p) => p.sessionID === linkedSession), "prompt recorded"),
      )
      expect(fakeServer.prompts[0]?.text).toBe("hello opencode")

      publishReply(linkedSession)
      yield* Effect.promise(() => waitUntil(() => bot.sent.some((m) => m.text === "assistant reply"), "reply sent"))
      expect(bot.sent.at(-1)?.chat_id).toBe(111)
    }),
  )

  it.live("runs chats in parallel without head-of-line blocking", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const firstLink = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${firstLink.token}`, chat: { id: 111, type: "private", first_name: "Ada" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "first chat linked"))
      const firstSession = fakeServer.createdSessions[0]

      const secondLink = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${secondLink.token}`, chat: { id: 222, type: "private", username: "grace" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 2, "second chat linked"))
      const secondSession = fakeServer.createdSessions[1]

      bot.push({ text: "slow question", chat: { id: 111, type: "private" } })
      bot.push({ text: "fast question", chat: { id: 222, type: "private" } })

      yield* Effect.promise(() =>
        waitUntil(
          () => fakeServer.prompts.some((p) => p.sessionID === secondSession && p.text === "fast question"),
          "second prompt recorded",
        ),
      )
      expect(fakeServer.prompts.length).toBe(2)
    }),
  )

  it.live("/stop cancels the mapped session", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 111, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked"))

      bot.push({ text: "/stop", chat: { id: 111, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.cancelled.length > 0, "cancel recorded"))

      expect(fakeServer.cancelled).toEqual([fakeServer.createdSessions[0]])
      yield* Effect.promise(() => waitUntil(() => bot.sent.at(-1)?.text === "Stop signal sent.", "stop confirmation"))
    }),
  )

  it.live("ignores messages from unlinked chats", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: "who is this?", chat: { id: 999, type: "private" } })
      yield* Effect.sleep(150)
      expect(fakeServer.prompts).toEqual([])
      expect(bot.sent).toEqual([])
    }),
  )

  it.live("/telegram in a chat issues a link that completes pairing", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      yield* bridge.link({ botToken: "test-token" })

      bot.push({ text: "/telegram", chat: { id: 555, type: "private", first_name: "Linus" } })
      yield* Effect.promise(() =>
        waitUntil(() => bot.sent.some((m) => m.chat_id === 555 && m.text.includes("t.me/")), "link reply"),
      )
      const reply = bot.sent.find((m) => m.chat_id === 555)!
      const token = reply.text.match(/\?start=(\S+)/)![1]
      expect(fakeServer.createdSessions).toEqual([])

      bot.push({ text: `/start ${token}`, chat: { id: 555, type: "private", first_name: "Linus" } })
      yield* Effect.promise(() => waitUntil(() => bot.sent.some((m) => m.text.includes("Linked to opencode session")), "paired session confirmation"))
      expect(bot.sent.at(-1)?.text).toContain("Linked to opencode session")

      const status = yield* bridge.status
      expect(status.linked).toEqual([{ chatId: 555, chatLabel: "Linus", sessionID: fakeServer.createdSessions[0], directory: "/tmp" }])
    }),
  )

  it.live("splits long replies into multiple messages", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 111, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked"))
      const linkedSession = fakeServer.createdSessions[0]

      bot.push({ text: "long answer please", chat: { id: 111, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.prompts.length === 1, "prompt recorded"))

      const paragraph = `para-${"x".repeat(900)}\n\n`
      const longText = paragraph.repeat(12)
      publishReply(linkedSession, longText)

      yield* Effect.promise(() =>
        waitUntil(() => bot.sent.filter((m) => m.chat_id === 111 && m.text.includes("para-")).length >= 3, "chunks sent"),
      )
      const joined = bot.sent
        .filter((m) => m.chat_id === 111 && m.text.includes("para-"))
        .map((m) => m.text)
        .join("\n")
      expect(joined.startsWith("para-")).toBe(true)
      for (const chunk of bot.sent.filter((m) => m.text.includes("para-"))) {
        expect(chunk.text!.length).toBeLessThanOrEqual(4100)
      }
    }),
  )

  it.live("formats fenced code blocks and inline code as HTML", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 111, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked"))
      const linkedSession = fakeServer.createdSessions[0]

      bot.push({ text: "show code", chat: { id: 111, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.prompts.length === 1, "prompt recorded"))

      publishReply(linkedSession, 'Look: `a < b` then\n```ts\nconst x = a < b && c > d\n```\ndone')
      yield* Effect.promise(() =>
        waitUntil(
          () => bot.sent.some((m) => m.chat_id === 111 && m.text.includes("<pre>")),
          "html reply sent",
        ),
      )
      const reply = bot.sent.find((m) => m.text.includes("<pre>"))!
      expect(reply.text).toContain('<code class="language-ts">const x = a &lt; b &amp;&amp; c &gt; d</code>')
      expect(reply.text).toContain("<code>a &lt; b</code>")
    }),
  )

  it.live("persists links to disk on link and restores them later", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 111, type: "private", first_name: "Ada" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked"))
      yield* Effect.promise(() => waitUntil(() => fs.existsSync(linksPath), "links persisted"))

      const persisted = JSON.parse(yield* Effect.promise(() => Bun.file(linksPath).text()))
      expect(persisted).toEqual([{ chatId: 111, chatLabel: "Ada", sessionID: fakeServer.createdSessions[0], directory: "/tmp" }])

      const status = yield* bridge.status
      expect(status.linked).toEqual(persisted)
    }),
  )

  it.live("restores previous run's links from disk without relinking", () =>
    Effect.gen(function* () {
      const restored = SessionID.make("ses-telegram-restored-1")
      yield* Effect.promise(() =>
        Bun.write(linksPath, JSON.stringify([{ chatId: 777, chatLabel: "Grace", sessionID: restored }])),
      )

      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const status = yield* bridge.status
      expect(status.linked).toEqual([{ chatId: 777, chatLabel: "Grace", sessionID: restored }])
    }),
  )

  it.live("mirrors events delivered via injected event source (Fix 1)", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      let handler!: (event: any) => void
      bridge.configure({
        baseUrl: fakeServer.url,
        events: {
          subscribe: (h) => {
            handler = h
            return () => {}
          },
        },
      })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 888, type: "private", first_name: "Injected" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked session"))
      const linkedSession = fakeServer.createdSessions[0]

      handler({
        payload: {
          type: "message.updated",
          properties: {
            info: {
              id: "msg_injected_1",
              role: "assistant",
              sessionID: linkedSession,
              time: {},
            },
          },
        },
      })
      handler({
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_injected_1",
              sessionID: linkedSession,
              messageID: "msg_injected_1",
              type: "text",
              text: "injected stream reply",
            },
          },
        },
      })
      handler({
        payload: {
          type: "message.updated",
          properties: {
            info: {
              id: "msg_injected_1",
              role: "assistant",
              sessionID: linkedSession,
              time: { completed: Date.now() },
            },
          },
        },
      })

      yield* Effect.promise(() =>
        waitUntil(() => bot.sent.some((m) => m.chat_id === 888 && m.text === "injected stream reply"), "injected reply sent"),
      )
      expect(bot.sent.at(-1)?.chat_id).toBe(888)
    }),
  )

  it.live("handles session creation error cleanly (Fix 5)", () =>
    Effect.gen(function* () {
      fakeServer.shouldFailCreate = true
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 999, type: "private" } })

      yield* Effect.promise(() =>
        waitUntil(() => bot.sent.some((m) => m.chat_id === 999 && m.text.includes("Could not create session")), "error reported"),
      )
      expect(fakeServer.createdSessions).toEqual([])
    }),
  )

  it.live("uses fallback server config when unconfigured (Fix 7)", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 101, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked session"))

      bot.push({ text: "hello fallback", chat: { id: 101, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.prompts.length === 1, "prompt recorded"))
      expect(fakeServer.prompts[0].text).toBe("hello fallback")
    }),
  )

  it.live("poll fiber survives a failing promptAsync call (Fix 7)", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 202, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked session"))

      fakeServer.shouldFailPrompt = true
      bot.push({ text: "failing message", chat: { id: 202, type: "private" } })
      yield* Effect.promise(() =>
        waitUntil(() => bot.sent.some((m) => m.chat_id === 202 && m.text.includes("OpenCode prompt error")), "error sent"),
      )

      bot.push({ text: "subsequent working message", chat: { id: 202, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.prompts.some((p) => p.text === "subsequent working message"), "poll fiber survived"))
      expect(fakeServer.prompts.at(-1)?.text).toBe("subsequent working message")
    }),
  )

  it.live("mirrors user prompts typed in opencode TUI to Telegram (Fix 13)", () =>
    Effect.gen(function* () {
      const bridge = yield* TelegramBridge.Service
      bridge.configure({ baseUrl: fakeServer.url })
      const link = yield* bridge.link({ botToken: "test-token" })
      bot.push({ text: `/start ${link.token}`, chat: { id: 303, type: "private" } })
      yield* Effect.promise(() => waitUntil(() => fakeServer.createdSessions.length === 1, "linked session"))
      const linkedSession = fakeServer.createdSessions[0]

      fakeServer.emitSSE({
        type: "message.updated",
        properties: {
          info: { id: "msg_user_tui_1", role: "user", sessionID: linkedSession, time: {} },
        },
      })
      fakeServer.emitSSE({
        type: "message.part.updated",
        properties: {
          part: { id: "prt_user_tui_1", sessionID: linkedSession, messageID: "msg_user_tui_1", type: "text", text: "tui user prompt" },
        },
      })

      yield* Effect.promise(() =>
        waitUntil(() => bot.sent.some((m) => m.chat_id === 303 && m.text === "👤 tui user prompt"), "user prompt mirrored"),
      )
      expect(bot.sent.some((m) => m.chat_id === 303 && m.text === "👤 tui user prompt")).toBe(true)
    }),
  )
})
