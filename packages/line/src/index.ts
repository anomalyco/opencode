import { createOpencode, type ToolPart } from "@opencode-ai/sdk"
import { messagingApi } from "@line/bot-sdk"
import { createHmac } from "node:crypto"

// --- Config ---
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN
const channelSecret = process.env.LINE_CHANNEL_SECRET
const port = Number(process.env.PORT ?? 3000)

if (!channelAccessToken || !channelSecret) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET")
  process.exit(1)
}

console.log("LINE bot configuration:")
console.log("- Channel access token present:", !!channelAccessToken)
console.log("- Channel secret present:", !!channelSecret)
console.log("- Webhook port:", port)

// --- LINE Client ---
const lineClient = new messagingApi.MessagingApiClient({ channelAccessToken })

// --- Start OpenCode server ---
console.log("Starting opencode server...")
const opencode = await createOpencode({ port: 0 })
console.log("Opencode server ready")

// --- Session Management ---
// LINE userId → { sessionId, userId }
const sessions = new Map<
  string,
  { sessionId: string; userId: string }
>()

// --- Subscribe to OpenCode events (tool updates) ---
;(async () => {
  const events = await opencode.client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.type === "tool") {
        for (const [userId, session] of sessions) {
          if (session.sessionId === part.sessionID) {
            handleToolUpdate(part, userId)
            break
          }
        }
      }
    }
  }
})()

async function handleToolUpdate(part: ToolPart, userId: string) {
  if (part.state.status !== "completed") return
  const toolMessage = `*${part.tool}* - ${part.state.title}`
  await lineClient
    .pushMessage({
      to: userId,
      messages: [{ type: "text", text: toolMessage }],
    })
    .catch(() => {})
}

// --- LINE Signature Validation ---
function validateSignature(body: string, signature: string): boolean {
  const hash = createHmac("SHA256", channelSecret!)
    .update(body)
    .digest("base64")
  return hash === signature
}

// --- Chunk long messages for LINE (max 5000 chars) ---
const LINE_MAX_TEXT = 5000

function chunkText(text: string, limit: number = LINE_MAX_TEXT): string[] {
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }

    let breakAt = remaining.lastIndexOf("\n", limit)
    if (breakAt < limit * 0.3) {
      breakAt = remaining.lastIndexOf(" ", limit)
    }
    if (breakAt < limit * 0.3) {
      breakAt = limit
    }

    const chunk = remaining.slice(0, breakAt)
    remaining = remaining.slice(breakAt).trimStart()

    // Handle unclosed code blocks
    const backtickCount = (chunk.match(/```/g) || []).length
    if (backtickCount % 2 !== 0) {
      chunks.push(chunk + "\n```")
      remaining = "```\n" + remaining
    } else {
      chunks.push(chunk)
    }
  }

  return chunks
}

// --- Send long message via Push API ---
async function sendMessage(userId: string, text: string): Promise<void> {
  const chunks = chunkText(text)
  for (const chunk of chunks) {
    await lineClient
      .pushMessage({
        to: userId,
        messages: [{ type: "text", text: chunk }],
      })
      .catch((err: any) => {
        console.error("Failed to send LINE message:", err?.message ?? err)
      })
  }
}

// --- Handle incoming LINE message ---
async function handleTextMessage(
  userId: string,
  text: string,
  replyToken: string,
): Promise<void> {
  console.log(`Message from ${userId}: ${text}`)

  // Special commands
  if (text.toLowerCase() === "/new") {
    sessions.delete(userId)
    await lineClient.replyMessage({
      replyToken,
      messages: [
        {
          type: "text",
          text: "Session cleared. Next message starts a new session.",
        },
      ],
    })
    return
  }

  if (text.toLowerCase() === "/abort") {
    const session = sessions.get(userId)
    if (session) {
      await opencode.client.session
        .abort({ path: { id: session.sessionId } })
        .catch(() => {})
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: "text", text: "Prompt cancelled." }],
      })
    } else {
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: "text", text: "No active session." }],
      })
    }
    return
  }

  if (text.toLowerCase() === "/sessions") {
    const session = sessions.get(userId)
    const msg = session
      ? `Active session: ${session.sessionId}`
      : "No active session. Send a message to start one."
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: msg }],
    })
    return
  }

  // Get or create OpenCode session
  let session = sessions.get(userId)

  if (!session) {
    console.log("Creating new opencode session...")
    const createResult = await opencode.client.session.create({
      body: { title: `LINE: ${userId.slice(-8)}` },
    })

    if (createResult.error) {
      console.error("Failed to create session:", createResult.error)
      await sendMessage(
        userId,
        "Failed to create coding session. Please try again.",
      )
      return
    }

    console.log("Created opencode session:", createResult.data.id)
    session = { sessionId: createResult.data.id, userId }
    sessions.set(userId, session)
  }

  // Send prompt to OpenCode
  console.log("Sending to opencode:", text)
  const result = await opencode.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts: [{ type: "text", text }] },
  })

  if (result.error) {
    console.error("Failed to send message:", result.error)

    // If session not found, clear and retry
    const errorStr = JSON.stringify(result.error)
    if (errorStr.includes("404") || errorStr.includes("not found")) {
      sessions.delete(userId)
      await sendMessage(userId, "Session expired. Please send your message again.")
    } else {
      await sendMessage(
        userId,
        "Sorry, I had trouble processing your message. Please try again.",
      )
    }
    return
  }

  const response = result.data

  // Build response text from parts
  const responseText =
    response.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n") || "I received your message but didn't have a response."

  console.log(`Response length: ${responseText.length} chars`)
  await sendMessage(userId, responseText)
}

// --- HTTP Server for LINE Webhook ---
Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    // Health check
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("OpenCode LINE Bot is running")
    }

    // LINE Webhook
    if (req.method === "POST" && url.pathname === "/webhook") {
      const body = await req.text()
      const signature = req.headers.get("x-line-signature") || ""

      if (!validateSignature(body, signature)) {
        console.error("Invalid LINE signature")
        return new Response("Invalid signature", { status: 403 })
      }

      let parsed: { events: any[] }
      try {
        parsed = JSON.parse(body)
      } catch {
        return new Response("Invalid JSON", { status: 400 })
      }

      // Process events async (return 200 immediately so LINE doesn't retry)
      for (const event of parsed.events) {
        if (
          event.type === "message" &&
          event.message?.type === "text" &&
          event.source?.userId
        ) {
          handleTextMessage(
            event.source.userId,
            event.message.text,
            event.replyToken,
          ).catch((err) => {
            console.error("Error handling message:", err)
          })
        }
      }

      return new Response("OK")
    }

    return new Response("Not Found", { status: 404 })
  },
})

console.log(`LINE bot webhook listening on http://localhost:${port}/webhook`)
