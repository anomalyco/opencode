import { Bot, InlineKeyboard, type Context } from "grammy"
import { createOpencode, createOpencodeClient, type ToolPart } from "@opencode-ai/sdk"

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required")
const bot = new Bot(token)

console.log("🚀 Starting opencode server...")
const opencode = await createOpencode({ port: 0 })

// Wire OPENCODE_DIRECTORY if set — pass it to client config so SDK sends x-opencode-directory header
if (process.env.OPENCODE_DIRECTORY) {
  opencode.client = createOpencodeClient({
    baseUrl: opencode.server.url,
    directory: process.env.OPENCODE_DIRECTORY,
  })
}

console.log("✅ Opencode server ready")

type Session = { client: any; server: any; sessionId: string; chatId: number; messageId?: number }
// TODO: Add per-chat rate limiting and LRU eviction for production use
const sessions = new Map<string, Session>()

type StreamState = { buffer: string; lastEdit: number; messageId: number }
const streams = new Map<string, StreamState>()

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function formatHtml(text: string): string {
  const escaped = escapeHtml(text)
  // Wrap code blocks in <pre><code>
  return escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`
  })
}

// Event subscription — fire-and-forget IIFE like Slack
void (async () => {
  const events = await opencode.client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.type === "tool") {
        for (const [_key, session] of sessions.entries()) {
          if (session.sessionId === part.sessionID) {
            void handleToolUpdate(part, session.chatId)
            break
          }
        }
      }
    }

    // Streaming text delta — handles both message.part.delta and session.next.text.delta
    const evt = event as any
    if (evt.type === "message.part.delta") {
      const { sessionID, field, delta } = evt.properties
      if (field === "text" && delta) {
        for (const [key, session] of sessions.entries()) {
          if (session.sessionId === sessionID) {
            const stream = streams.get(key)
            if (!stream) break
            stream.buffer += delta
            if (Date.now() - stream.lastEdit > 1500) {
              const text = formatHtml(stream.buffer) + "▌"
              await bot.api
                .editMessageText(session.chatId, stream.messageId, text, { parse_mode: "HTML" })
                .catch(() => {})
              stream.lastEdit = Date.now()
            }
            break
          }
        }
      }
    }

    // Fallback streaming delta via session events
    if (evt.type === "session.next.text.delta") {
      const { sessionID, delta } = evt.properties
      if (delta) {
        for (const [key, session] of sessions.entries()) {
          if (session.sessionId === sessionID) {
            const stream = streams.get(key)
            if (!stream) break
            stream.buffer += delta
            if (Date.now() - stream.lastEdit > 1500) {
              const text = formatHtml(stream.buffer) + "▌"
              await bot.api
                .editMessageText(session.chatId, stream.messageId, text, { parse_mode: "HTML" })
                .catch(() => {})
              stream.lastEdit = Date.now()
            }
            break
          }
        }
      }
    }

    // Permission request — show approve/deny inline keyboard
    if (evt.type === "permission.asked") {
      const { id, sessionID, permission } = evt.properties
      for (const [_key, session] of sessions.entries()) {
        if (session.sessionId === sessionID) {
          const keyboard = new InlineKeyboard()
            .text("✅ Approve", `perm:approve:${id}:${sessionID}`)
            .text("❌ Deny", `perm:deny:${id}:${sessionID}`)
          await bot.api
            .sendMessage(session.chatId, `🔐 <b>Permission Request</b>\n\n${escapeHtml(permission || "Unknown permission")}`, {
              parse_mode: "HTML",
              reply_markup: keyboard,
            })
            .catch(() => {})
          break
        }
      }
    }

    // Question asked — show inline keyboard with options or free-form prompt
    if (evt.type === "question.asked") {
      const { id, sessionID, questions } = evt.properties
      for (const [_key, session] of sessions.entries()) {
        if (session.sessionId === sessionID) {
          for (const question of questions) {
            let keyboard = new InlineKeyboard()
            if (question.options && question.options.length > 0) {
              for (const option of question.options) {
                keyboard = keyboard.text(option, `q:${id}:${sessionID}:${option}`)
                if (question.options.indexOf(option) < question.options.length - 1) {
                  keyboard = keyboard.row()
                }
              }
            }
            const messageText = question.header
              ? `❓ <b>${escapeHtml(question.header)}</b>\n\n${escapeHtml(question.question)}`
              : `❓ ${escapeHtml(question.question)}`
            await bot.api
              .sendMessage(session.chatId, messageText, {
                parse_mode: "HTML",
                ...(question.options && question.options.length > 0 ? { reply_markup: keyboard } : {}),
              })
              .catch(() => {})
          }
          break
        }
      }
    }
  }
})()

async function handleToolUpdate(part: ToolPart, chatId: number) {
  if (part.state.status !== "completed") return
  const toolMessage = `🔧 <b>${escapeHtml(part.tool)}</b> — ${escapeHtml(part.state.title)}`
  await bot.api.sendMessage(chatId, toolMessage, { parse_mode: "HTML" }).catch(() => {})
}

function chunkMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }
    let splitAt = remaining.lastIndexOf("\n", limit)
    if (splitAt === -1) splitAt = remaining.lastIndexOf(" ", limit)
    if (splitAt === -1) splitAt = limit
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt + 1)
  }
  return chunks
}

// ── Command handlers ──────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 <b>OpenCode Telegram Bot</b>\n\n" +
      "I can help you interact with OpenCode directly from Telegram.\n\n" +
      "Commands:\n" +
      "/help — List all commands\n" +
      "/sessions — List active sessions\n" +
      "/abort — Abort current agent loop\n" +
      "/model — Show current model\n" +
      "/mode — Show current mode\n\n" +
      "Just send me a message to start a session!",
    { parse_mode: "HTML" },
  )
})

bot.command("help", async (ctx) => {
  await ctx.reply(
    "🤖 <b>Commands</b>\n\n" +
      "/start — Welcome message\n" +
      "/help — This message\n" +
      "/sessions — List active sessions\n" +
      "/abort — Abort current agent loop\n" +
      "/model — Show current model\n" +
      "/mode — Show current mode",
    { parse_mode: "HTML" },
  )
})

bot.command("sessions", async (ctx) => {
  if (sessions.size === 0) {
    await ctx.reply("No active sessions.")
    return
  }
  const lines = [...sessions.entries()].map(
    ([key, session]) => `• <code>${session.sessionId}</code> (${key})`,
  )
  await ctx.reply(`<b>Active Sessions (${sessions.size})</b>\n\n${lines.join("\n")}`, {
    parse_mode: "HTML",
  })
})

bot.command("abort", async (ctx) => {
  const chatId = ctx.chat.id
  const threadId = ctx.message?.message_thread_id ?? 0
  const sessionKey = `${chatId}-${threadId}`
  const session = sessions.get(sessionKey)
  if (!session) {
    await ctx.reply("No active session in this chat.")
    return
  }
  await session.client.session.abort({ path: { id: session.sessionId } }).catch(() => {})
  streams.delete(sessionKey)
  await ctx.reply("🛑 Agent loop aborted.")
})

bot.command("model", async (ctx) => {
  const chatId = ctx.chat.id
  const threadId = ctx.message?.message_thread_id ?? 0
  const sessionKey = `${chatId}-${threadId}`
  const session = sessions.get(sessionKey)
  if (!session) {
    await ctx.reply("No active session. Send a message first.")
    return
  }
  const info = await session.client.session.get({ path: { id: session.sessionId } }).catch(() => undefined)
  const model = (info as any)?.data?.model || "unknown"
  await ctx.reply(`📋 Current model: <code>${model}</code>`, { parse_mode: "HTML" })
})

bot.command("mode", async (ctx) => {
  const chatId = ctx.chat.id
  const threadId = ctx.message?.message_thread_id ?? 0
  const sessionKey = `${chatId}-${threadId}`
  const session = sessions.get(sessionKey)
  if (!session) {
    await ctx.reply("No active session. Send a message first.")
    return
  }
  const info = await session.client.session.get({ path: { id: session.sessionId } }).catch(() => undefined)
  const mode = (info as any)?.data?.mode || "unknown"
  await ctx.reply(`📋 Current mode: <code>${mode}</code>`, { parse_mode: "HTML" })
})

// ── Message handler ───────────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id
  const threadId = ctx.message?.message_thread_id ?? 0
  const sessionKey = `${chatId}-${threadId}`

  let session = sessions.get(sessionKey)

  if (!session) {
    console.log("🆕 Creating new opencode session...")
    const { client, server } = opencode

    const createResult = await client.session.create({ body: { title: `Telegram chat ${chatId}` } })
    if (createResult.error) {
      console.error("❌ Failed to create session:", createResult.error)
      await ctx.reply("Sorry, I had trouble creating a session. Please try again.")
      return
    }

    console.log("✅ Created opencode session:", createResult.data.id)
    session = { client, server, sessionId: createResult.data.id, chatId }
    sessions.set(sessionKey, session)

    const shareResult = await client.session.share({ path: { id: createResult.data.id } })
    if (!shareResult.error && shareResult.data) {
      const url = shareResult.data.share?.url
      if (url) await ctx.reply(url)
    }
  }

  // Send placeholder message immediately for streaming
  const placeholder = await bot.api.sendMessage(chatId, "⏳ Thinking...", {
    ...(threadId > 0 ? { reply_to_message_id: threadId } : {}),
  })
  streams.set(sessionKey, { buffer: "", lastEdit: 0, messageId: placeholder.message_id })
  session.messageId = placeholder.message_id

  console.log("📝 Sending to opencode:", ctx.message.text)
  const result = await session.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts: [{ type: "text", text: ctx.message.text }] },
  })

  streams.delete(sessionKey)

  if (result.error) {
    console.error("❌ Failed to send message:", result.error)
    await bot.api
      .editMessageText(chatId, placeholder.message_id, "❌ Failed to process message.", { parse_mode: "HTML" })
      .catch(() => {})
    return
  }

  const response = result.data
  const responseText =
    response.info?.content ||
    response.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") ||
    "I received your message but didn't have a response."

  // Final edit — replace the streaming message with the complete response
  const formattedText = formatHtml(responseText)
  const chunks = chunkMessage(formattedText)

  if (chunks.length <= 1) {
    await bot.api
      .editMessageText(chatId, placeholder.message_id, chunks[0] || "No response", { parse_mode: "HTML" })
      .catch(() => {})
  } else {
    await bot.api
      .editMessageText(chatId, placeholder.message_id, chunks[0], { parse_mode: "HTML" })
      .catch(() => {})
    for (let i = 1; i < chunks.length; i++) {
      await bot.api.sendMessage(chatId, chunks[i], {
        ...(threadId > 0 ? { reply_to_message_id: threadId } : {}),
        parse_mode: "HTML",
      })
    }
  }
})

// ── Callback query handlers ───────────────────────────────────────

bot.callbackQuery(/^perm:(approve|deny):([^:]+):(.+)$/, async (ctx) => {
  const action = ctx.match[1]
  const permissionId = ctx.match[2]
  const sessionID = ctx.match[3]
  const session = [...sessions.values()].find((s) => s.sessionId === sessionID)
  if (!session) {
    await ctx.answerCallbackQuery("Error: no session")
    return
  }
  const approved = action === "approve"
  await session.client
    .postSessionIdPermissionsPermissionId({
      path: { id: session.sessionId, permissionID: permissionId },
      body: { response: approved ? "once" : "reject" },
    })
    .catch(() => {})
  await ctx.answerCallbackQuery(approved ? "✅ Approved" : "❌ Denied")
  await ctx.editMessageText(`🔐 Permission: ${approved ? "✅ Approved" : "❌ Denied"}`).catch(() => {})
})

bot.callbackQuery(/^q:([^:]+):([^:]+):(.+)$/, async (ctx) => {
  const questionId = ctx.match[1]
  const sessionID = ctx.match[2]
  const answer = ctx.match[3]
  const session = [...sessions.values()].find((s) => s.sessionId === sessionID)
  if (!session) {
    await ctx.answerCallbackQuery("Error: no session")
    return
  }
  await (session.client as any)
    .question.respond({
      path: { id: questionId },
      body: { answer },
    })
    .catch(() => {})
  await ctx.answerCallbackQuery(`${answer}`)
  await ctx.editMessageText(`❓ Answered: ${answer}`).catch(() => {})
})

// Prevent grammy warnings about unhandled callback queries
bot.callbackQuery(/.*/, async (ctx) => {
  await ctx.answerCallbackQuery()
})

bot.start()
console.log("🤖 Telegram bot is running!")
