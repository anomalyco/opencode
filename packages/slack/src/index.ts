import { App } from "@slack/bolt"
import { createOpencode, type ToolPart } from "@opencode-ai/sdk"

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
})

console.log("🔧 Bot configuration:")
console.log("- Bot token present:", !!process.env.SLACK_BOT_TOKEN)
console.log("- Signing secret present:", !!process.env.SLACK_SIGNING_SECRET)
console.log("- App token present:", !!process.env.SLACK_APP_TOKEN)

console.log("🚀 Starting opencode server...")
const opencode = await createOpencode({
  port: 0,
})
console.log("✅ Opencode server ready")

const sessions = new Map<string, { client: any; server: any; sessionId: string; channel: string; thread: string; lastUsed: number }>()

// Session cleanup: remove sessions older than 1 hour
const SESSION_TIMEOUT_MS = 60 * 60 * 1000
const MAX_SESSIONS = 100

function cleanupOldSessions() {
  const now = Date.now()
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastUsed > SESSION_TIMEOUT_MS || sessions.size > MAX_SESSIONS) {
      sessions.delete(key)
      console.log("🧹 Cleaned up session:", key)
    }
  }
}

// Run cleanup periodically
setInterval(cleanupOldSessions, 5 * 60 * 1000) // Every 5 minutes

;(async () => {
  const events = await opencode.client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.type === "tool") {
        // Find the session for this tool update
        for (const [sessionKey, session] of sessions.entries()) {
          if (session.sessionId === part.sessionID) {
            session.lastUsed = Date.now()
            handleToolUpdate(part, session.channel, session.thread)
            break
          }
        }
      }
    }
  }
})()

async function handleToolUpdate(part: ToolPart, channel: string, thread: string) {
  if (part.state.status !== "completed") return
  const toolMessage = `*${part.tool}* - ${part.state.title}`
  await app.client.chat
    .postMessage({
      channel,
      thread_ts: thread,
      text: toolMessage,
    })
    .catch(() => {})
}

app.use(async ({ next, context }) => {
  console.log("📡 Raw Slack event:", JSON.stringify(context, null, 2))
  await next()
})

app.message(async ({ message, say }) => {
  console.log("📨 Received message event:", JSON.stringify(message, null, 2))

  if (message.subtype || !("text" in message) || !message.text) {
    console.log("⏭️ Skipping message - no text or has subtype")
    return
  }

  console.log("✅ Processing message:", message.text)

  const channel = message.channel
  const thread = (message as any).thread_ts || message.ts
  const sessionKey = `${channel}-${thread}`

  let session = sessions.get(sessionKey)

  if (!session) {
    console.log("🆕 Creating new opencode session...")
    const { client, server } = opencode

    const createResult = await client.session.create({
      body: { title: `Slack thread ${thread}` },
    })

    if (createResult.error) {
      console.error("❌ Failed to create session:", createResult.error)
      await say({
        text: "Sorry, I had trouble creating a session. Please try again.",
        thread_ts: thread,
      })
      return
    }

    console.log("✅ Created opencode session:", createResult.data.id)

    session = { client, server, sessionId: createResult.data.id, channel, thread, lastUsed: Date.now() }
    sessions.set(sessionKey, session)

    const shareResult = await client.session.share({ path: { id: createResult.data.id } })
    if (!shareResult.error && shareResult.data) {
      const sessionUrl = shareResult.data.share?.url!
      console.log("🔗 Session shared:", sessionUrl)
      await app.client.chat.postMessage({ channel, thread_ts: thread, text: sessionUrl })
    }
  }

  console.log("📝 Sending to opencode:", message.text)
  session.lastUsed = Date.now()
  const result = await session.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts: [{ type: "text", text: message.text }] },
  })

  console.log("📤 Opencode response:", JSON.stringify(result, null, 2))

  if (result.error) {
    console.error("❌ Failed to send message:", result.error)
    await say({
      text: "Sorry, I had trouble processing your message. Please try again.",
      thread_ts: thread,
    })
    return
  }

  const response = result.data

  // Build response text
  const responseText =
    response.info?.content ||
    response.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") ||
    "I received your message but didn't have a response."

  console.log("💬 Sending response:", responseText)

  // Send main response (tool updates will come via live events)
  await say({ text: responseText, thread_ts: thread })
})

app.command("/test", async ({ command, ack, say }) => {
  await ack()
  console.log("🧪 Test command received:", JSON.stringify(command, null, 2))
  await say("🤖 Bot is working! I can hear you loud and clear.")
})

await app.start()
console.log("⚡️ Slack bot is running!")

// Graceful shutdown handler
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...")
  sessions.clear()
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down...")
  sessions.clear()
  process.exit(0)
})
