import { Bot, type Context } from "grammy"
import { createOpencode, type ToolPart } from "@opencode-ai/sdk"

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

console.log("🚀 Starting opencode server...")
const opencode = await createOpencode({ port: 0 })
console.log("✅ Opencode server ready")

type Session = { client: any; server: any; sessionId: string; chatId: number; messageId?: number }
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
  }
})()

async function handleToolUpdate(part: ToolPart, chatId: number) {
  if (part.state.status !== "completed") return
  const toolMessage = `🔧 <b>${part.tool}</b> — ${part.state.title}`
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

bot.start()
console.log("🤖 Telegram bot is running!")
