import { Telegraf, Markup } from "telegraf"
import { message } from "telegraf/filters"
import { createOpencode, type ToolPart, type Part, type Event, type Session, type SessionStatus } from "@opencode-ai/sdk"

// ── Config ─────────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN environment variable is required")
  process.exit(1)
}

const ALLOWED_CHAT_IDS = process.env.TELEGRAM_ALLOWED_CHAT_IDS
  ? process.env.TELEGRAM_ALLOWED_CHAT_IDS.split(",").map((id) => Number(id.trim()))
  : []

console.log("Bot configuration:")
console.log("- Bot token present:", !!BOT_TOKEN)
console.log("- Allowed chat IDs:", ALLOWED_CHAT_IDS.length > 0 ? ALLOWED_CHAT_IDS.join(", ") : "all (no restriction)")

// ── OpenCode ───────────────────────────────────────────────────────────────────

console.log("Starting opencode server...")
const opencode = await createOpencode({ port: 0 })
console.log("OpenCode server ready")

// ── State ──────────────────────────────────────────────────────────────────────

interface ChatSession {
  sessionId: string
  chatId: number
  /** The message ID used as thread root (reply-to) for this session */
  threadMessageId?: number
  lastStatusMessageId?: number
}

/** Map from chatId (or chatId:threadMsgId) to session info */
const sessions = new Map<string, ChatSession>()

/** Map from opencode sessionId to ChatSession for reverse lookup in events */
const sessionsBySid = new Map<string, ChatSession>()

function sessionKey(chatId: number, threadMessageId?: number): string {
  return threadMessageId ? `${chatId}:${threadMessageId}` : `${chatId}`
}

// ── Telegram Bot ───────────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN)

function isAuthorized(chatId: number): boolean {
  if (ALLOWED_CHAT_IDS.length === 0) return true
  return ALLOWED_CHAT_IDS.includes(chatId)
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&")
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 3) + "..."
}

// ── Commands ───────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) {
    await ctx.reply("You are not authorized to use this bot.")
    return
  }
  await ctx.reply(
    [
      "*OpenCode Telegram Bot*",
      "",
      "Send me any message to interact with OpenCode\\.",
      "",
      "*Commands:*",
      "/new \\- Create a new session",
      "/sessions \\- List active sessions",
      "/status \\- Show current session status",
      "/abort \\- Abort the current session",
      "/diff \\- Show the current session diff",
      "/share \\- Share the current session",
      "/cmd `<command>` \\- Execute an OpenCode command",
      "/help \\- Show this help message",
    ].join("\n"),
    { parse_mode: "MarkdownV2" },
  )
})

bot.command("help", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) return
  await ctx.reply(
    [
      "*OpenCode Commands*",
      "",
      "/new \\- Create a new session",
      "/sessions \\- List active sessions",
      "/status \\- Show current session status",
      "/abort \\- Abort the current session",
      "/diff \\- Show the current session diff",
      "/share \\- Share the current session",
      "/cmd `<command>` \\- Execute an OpenCode command \\(e\\.g\\. /compact\\)",
      "/help \\- Show this help message",
    ].join("\n"),
    { parse_mode: "MarkdownV2" },
  )
})

bot.command("new", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) return

  const createResult = await opencode.client.session.create({
    body: { title: `Telegram ${ctx.chat.id}` },
  })

  if (createResult.error) {
    await ctx.reply("Failed to create session. Please try again.")
    return
  }

  const session: ChatSession = {
    sessionId: createResult.data.id,
    chatId: ctx.chat.id,
  }
  const key = sessionKey(ctx.chat.id)
  sessions.set(key, session)
  sessionsBySid.set(session.sessionId, session)

  await ctx.reply(`New session created: \`${createResult.data.id}\``, { parse_mode: "MarkdownV2" })
})

bot.command("sessions", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) return

  const result = await opencode.client.session.list()
  if (result.error || !result.data) {
    await ctx.reply("Failed to list sessions.")
    return
  }

  const sessionList = result.data as Session[]
  if (sessionList.length === 0) {
    await ctx.reply("No active sessions.")
    return
  }

  const currentKey = sessionKey(ctx.chat.id)
  const currentSession = sessions.get(currentKey)

  const lines = sessionList.slice(0, 20).map((s) => {
    const marker = currentSession?.sessionId === s.id ? " (current)" : ""
    const title = s.title || "Untitled"
    return `- \`${s.id.slice(0, 8)}\` ${escapeMarkdown(title)}${marker}`
  })

  await ctx.reply(["*Sessions:*", ...lines].join("\n"), { parse_mode: "MarkdownV2" })
})

bot.command("status", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) return

  const key = sessionKey(ctx.chat.id)
  const session = sessions.get(key)
  if (!session) {
    await ctx.reply("No active session. Send a message or use /new to start one.")
    return
  }

  const statusResult = await opencode.client.session.status()
  if (statusResult.error) {
    await ctx.reply("Failed to get session status.")
    return
  }

  const statuses = statusResult.data as Record<string, SessionStatus>
  const status = statuses[session.sessionId]
  const statusText = status ? status.type : "unknown"

  await ctx.reply(`Session \`${session.sessionId.slice(0, 8)}\` status: *${escapeMarkdown(statusText)}*`, {
    parse_mode: "MarkdownV2",
  })
})

bot.command("abort", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) return

  const key = sessionKey(ctx.chat.id)
  const session = sessions.get(key)
  if (!session) {
    await ctx.reply("No active session to abort.")
    return
  }

  const result = await opencode.client.session.abort({
    path: { id: session.sessionId },
  })

  if (result.error) {
    await ctx.reply("Failed to abort session.")
    return
  }

  await ctx.reply("Session aborted.")
})

bot.command("diff", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) return

  const key = sessionKey(ctx.chat.id)
  const session = sessions.get(key)
  if (!session) {
    await ctx.reply("No active session.")
    return
  }

  const result = await opencode.client.session.diff({
    path: { id: session.sessionId },
  })

  if (result.error || !result.data) {
    await ctx.reply("Failed to get diff or no changes yet.")
    return
  }

  const diffs = (result.data as any[]) || []
  if (diffs.length === 0) {
    await ctx.reply("No file changes in this session.")
    return
  }

  const summary = diffs
    .map((d: any) => {
      return `${d.file}: +${d.additions} -${d.deletions}`
    })
    .join("\n")

  const text = truncate(summary, 4000)
  await ctx.reply(`\`\`\`\n${text}\n\`\`\``, { parse_mode: "MarkdownV2" })
})

bot.command("share", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) return

  const key = sessionKey(ctx.chat.id)
  const session = sessions.get(key)
  if (!session) {
    await ctx.reply("No active session to share.")
    return
  }

  const result = await opencode.client.session.share({
    path: { id: session.sessionId },
  })

  if (result.error || !result.data) {
    await ctx.reply("Failed to share session.")
    return
  }

  const shareUrl = (result.data as any).share?.url
  if (shareUrl) {
    await ctx.reply(`Session shared: ${shareUrl}`)
  } else {
    await ctx.reply("Session shared but no URL was returned.")
  }
})

bot.command("cmd", async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) return

  const key = sessionKey(ctx.chat.id)
  const session = sessions.get(key)
  if (!session) {
    await ctx.reply("No active session. Send a message first to create one.")
    return
  }

  const commandText = ctx.message.text.replace(/^\/cmd\s*/, "").trim()
  if (!commandText) {
    await ctx.reply("Usage: /cmd <command>\nExample: /cmd /compact")
    return
  }

  // Parse command name and arguments
  const parts = commandText.match(/^\/(\S+)\s*(.*)$/)
  if (!parts) {
    await ctx.reply("Command should start with /. Example: /cmd /compact")
    return
  }

  const result = await opencode.client.session.command({
    path: { id: session.sessionId },
    body: { command: parts[1]!, arguments: parts[2] || "" },
  })

  if (result.error) {
    await ctx.reply(`Command failed: ${JSON.stringify(result.error)}`)
    return
  }

  await ctx.reply("Command executed.")
})

// ── Message Handling ───────────────────────────────────────────────────────────

bot.on(message("text"), async (ctx) => {
  if (!isAuthorized(ctx.chat.id)) {
    await ctx.reply("You are not authorized to use this bot.")
    return
  }

  const text = ctx.message.text
  if (!text) return

  const key = sessionKey(ctx.chat.id)
  let session = sessions.get(key)

  // Create session if none exists
  if (!session) {
    const createResult = await opencode.client.session.create({
      body: { title: `Telegram ${ctx.chat.id}` },
    })

    if (createResult.error) {
      await ctx.reply("Failed to create session. Please try again.")
      return
    }

    session = {
      sessionId: createResult.data.id,
      chatId: ctx.chat.id,
    }
    sessions.set(key, session)
    sessionsBySid.set(session.sessionId, session)
  }

  // Send typing indicator
  await ctx.sendChatAction("typing")

  // Send prompt to opencode
  const result = await opencode.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts: [{ type: "text", text }] },
  })

  if (result.error) {
    const errMsg = typeof result.error === "object" && "data" in result.error ? (result.error as any).data?.message : String(result.error)
    await ctx.reply(`Error: ${errMsg || "Failed to process message. Please try again."}`)
    return
  }

  const response = result.data as any

  // Extract text response
  const responseParts: string[] = []

  if (response.parts) {
    for (const part of response.parts) {
      if (part.type === "text" && part.text) {
        responseParts.push(part.text)
      }
    }
  }

  if (response.info?.content) {
    responseParts.push(response.info.content)
  }

  const responseText = responseParts.join("\n") || "Message received, processing..."

  // Telegram has a 4096 character limit per message
  const chunks = splitMessage(responseText, 4000)
  for (const chunk of chunks) {
    await ctx.reply(chunk).catch(async () => {
      // Fallback: try without any parse mode
      await ctx.reply(chunk)
    })
  }
})

// ── Event Streaming ────────────────────────────────────────────────────────────

;(async () => {
  const events = await opencode.client.event.subscribe()
  for await (const event of events.stream) {
    try {
      await handleEvent(event as Event)
    } catch (err) {
      console.error("Error handling event:", err)
    }
  }
})()

async function handleEvent(event: Event) {
  switch (event.type) {
    case "message.part.updated":
      await handlePartUpdate(event.properties.part, event.properties.delta)
      break

    case "session.error":
      await handleSessionError(event.properties)
      break

    case "todo.updated":
      await handleTodoUpdate(event.properties)
      break
  }
}

async function handlePartUpdate(part: Part, delta?: string) {
  if (part.type !== "tool") return

  const session = sessionsBySid.get(part.sessionID)
  if (!session) return

  const toolPart = part as ToolPart
  if (toolPart.state.status !== "completed") return

  const toolMessage = `[tool] ${toolPart.tool}: ${toolPart.state.title || "done"}`
  await bot.telegram
    .sendMessage(session.chatId, toolMessage, {
      reply_parameters: session.threadMessageId ? { message_id: session.threadMessageId } : undefined,
    })
    .catch(() => {})
}

async function handleSessionError(properties: any) {
  const sessionId = properties.sessionID
  if (!sessionId) return

  const session = sessionsBySid.get(sessionId)
  if (!session) return

  const error = properties.error
  const errorMsg = error?.data?.message || error?.name || "Unknown error"

  await bot.telegram
    .sendMessage(session.chatId, `Error: ${errorMsg}`, {
      reply_parameters: session.threadMessageId ? { message_id: session.threadMessageId } : undefined,
    })
    .catch(() => {})
}

async function handleTodoUpdate(properties: any) {
  const sessionId = properties.sessionID
  if (!sessionId) return

  const session = sessionsBySid.get(sessionId)
  if (!session) return

  const todos = properties.todos as Array<{ content: string; status: string }>
  if (!todos || todos.length === 0) return

  const lines = todos.map((t) => {
    const icon = t.status === "completed" ? "[done]" : t.status === "in_progress" ? "[...]" : "[ ]"
    return `${icon} ${t.content}`
  })

  const msg = `Tasks:\n${lines.join("\n")}`
  const truncated = truncate(msg, 4000)

  // Update existing status message or send new one
  if (session.lastStatusMessageId) {
    await bot.telegram
      .editMessageText(session.chatId, session.lastStatusMessageId, undefined, truncated)
      .catch(async () => {
        const sent = await bot.telegram.sendMessage(session.chatId, truncated).catch(() => null)
        if (sent) session.lastStatusMessageId = sent.message_id
      })
  } else {
    const sent = await bot.telegram.sendMessage(session.chatId, truncated).catch(() => null)
    if (sent) session.lastStatusMessageId = sent.message_id
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen)
    if (splitIdx <= 0) {
      // Try to split at a space
      splitIdx = remaining.lastIndexOf(" ", maxLen)
    }
    if (splitIdx <= 0) {
      splitIdx = maxLen
    }

    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx).replace(/^\n/, "")
  }

  return chunks
}

// ── Graceful Shutdown ──────────────────────────────────────────────────────────

process.once("SIGINT", () => {
  bot.stop("SIGINT")
  opencode.server.close()
})
process.once("SIGTERM", () => {
  bot.stop("SIGTERM")
  opencode.server.close()
})

// ── Launch ─────────────────────────────────────────────────────────────────────

await bot.launch()
console.log("Telegram bot is running!")
