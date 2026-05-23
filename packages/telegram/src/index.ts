import { Bot, type Context } from "grammy"
import { createOpencode, type ToolPart } from "@opencode-ai/sdk"

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

console.log("🚀 Starting opencode server...")
const opencode = await createOpencode({ port: 0 })
console.log("✅ Opencode server ready")

type Session = { client: any; server: any; sessionId: string; chatId: number; messageId?: number }
const sessions = new Map<string, Session>()

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

  console.log("📝 Sending to opencode:", ctx.message.text)
  const result = await session.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts: [{ type: "text", text: ctx.message.text }] },
  })

  if (result.error) {
    console.error("❌ Failed to send message:", result.error)
    await ctx.reply("Sorry, I had trouble processing your message. Please try again.")
    return
  }

  const response = result.data
  const responseText =
    response.info?.content ||
    response.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") ||
    "I received your message but didn't have a response."

  const chunks = chunkMessage(responseText)
  for (const chunk of chunks) {
    await bot.api.sendMessage(chatId, chunk, {
      ...(threadId > 0 ? { reply_to_message_id: threadId } : {}),
      parse_mode: "HTML",
    })
  }
})

bot.start()
console.log("🤖 Telegram bot is running!")
