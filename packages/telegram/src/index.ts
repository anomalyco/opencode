import { Bot, type Context } from "grammy"
import { createOpencode, type ToolPart } from "@opencode-ai/sdk"
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { randomBytes } from "crypto"

// ── Config ──────────────────────────────────────────────────────────────────

const STATE_DIR = process.env.TELEGRAM_STATE_DIR ?? join(homedir(), ".opencode", "channels", "telegram")
const ACCESS_FILE = join(STATE_DIR, "access.json")
const APPROVED_DIR = join(STATE_DIR, "approved")
const ENV_FILE = join(STATE_DIR, ".env")

// Load .env for bot token
try {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!
  }
} catch {}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
  console.error(
    `telegram channel: TELEGRAM_BOT_TOKEN required\n` +
    `  set in ${ENV_FILE}\n` +
    `  format: TELEGRAM_BOT_TOKEN=123456789:AAH...\n`,
  )
  process.exit(1)
}

// ── Access Control ──────────────────────────────────────────────────────────

type PendingEntry = {
  senderId: string
  chatId: string
  createdAt: number
  expiresAt: number
  replies: number
}

type GroupPolicy = {
  requireMention: boolean
  allowFrom: string[]
}

type Access = {
  dmPolicy: "pairing" | "allowlist" | "disabled"
  allowFrom: string[]
  groups: Record<string, GroupPolicy>
  pending: Record<string, PendingEntry>
  mentionPatterns?: string[]
}

function loadAccess(): Access {
  try {
    return JSON.parse(readFileSync(ACCESS_FILE, "utf8"))
  } catch {
    return { dmPolicy: "pairing", allowFrom: [], groups: {}, pending: {} }
  }
}

function saveAccess(access: Access) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(ACCESS_FILE, JSON.stringify(access, null, 2))
}

// ── Pairing ─────────────────────────────────────────────────────────────────

function generatePairingCode(): string {
  return randomBytes(3).toString("hex")
}

function handlePairing(senderId: string, chatId: string): string {
  const access = loadAccess()

  // Already allowed
  if (access.allowFrom.includes(senderId)) {
    return "You are already paired. Send messages and I will respond."
  }

  // Check existing pending
  const existing = Object.entries(access.pending).find(([, v]) => v.senderId === senderId)
  if (existing) {
    const [code, entry] = existing
    if (entry.expiresAt > Date.now()) {
      entry.replies = (entry.replies || 0) + 1
      if (entry.replies > 3) {
        delete access.pending[code]
        saveAccess(access)
        return "Too many attempts. Please try again later."
      }
      saveAccess(access)
      return `Your pairing code is: ${code}\nAsk the admin to run: opencode telegram pair ${code}`
    }
    delete access.pending[code]
  }

  // Clean expired
  for (const [code, entry] of Object.entries(access.pending)) {
    if (entry.expiresAt < Date.now()) delete access.pending[code]
  }

  // Max 3 pending
  if (Object.keys(access.pending).length >= 3) {
    saveAccess(access)
    return "Too many pending pairing requests. Please try again later."
  }

  const code = generatePairingCode()
  access.pending[code] = {
    senderId,
    chatId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600_000,
    replies: 1,
  }
  saveAccess(access)
  return `Your pairing code is: ${code}\nAsk the admin to approve with: opencode telegram pair ${code}\nThis code expires in 1 hour.`
}

// ── Approved polling ────────────────────────────────────────────────────────

function pollApproved(bot: Bot) {
  setInterval(async () => {
    try {
      mkdirSync(APPROVED_DIR, { recursive: true })
      for (const file of readdirSync(APPROVED_DIR)) {
        const chatId = readFileSync(join(APPROVED_DIR, file), "utf8").trim()
        if (chatId) {
          await bot.api.sendMessage(chatId, "You have been approved! You can now send me messages.").catch(() => {})
        }
        rmSync(join(APPROVED_DIR, file))
      }
    } catch {}
  }, 5000)
}

// ── Gate ─────────────────────────────────────────────────────────────────────

function gate(ctx: Context): "allow" | "pair" | "deny" {
  const access = loadAccess()
  const senderId = String(ctx.from?.id ?? "")
  const chatId = String(ctx.chat?.id ?? "")

  // Group message
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    const groupPolicy = access.groups[chatId]
    if (!groupPolicy) return "deny"

    // Check mention requirement
    if (groupPolicy.requireMention) {
      const text = ctx.message?.text ?? ctx.message?.caption ?? ""
      const patterns = access.mentionPatterns ?? []
      const mentioned = patterns.some((p) => text.includes(p))
      if (!mentioned) return "deny"
    }

    // Check group allowFrom
    if (groupPolicy.allowFrom.length > 0 && !groupPolicy.allowFrom.includes(senderId)) {
      return "deny"
    }
    return "allow"
  }

  // DM
  if (access.dmPolicy === "disabled") return "deny"
  if (access.allowFrom.includes(senderId)) return "allow"
  if (access.dmPolicy === "pairing") return "pair"
  return "deny"
}

// ── Session management ──────────────────────────────────────────────────────

const chatSessions = new Map<string, string>() // chatId -> sessionId

// ── Main ────────────────────────────────────────────────────────────────────

console.log("Starting opencode server...")
const opencode = await createOpencode({ port: 0 })
console.log("Opencode server ready")

const bot = new Bot(TOKEN)
let botUsername = ""

// Fetch bot info for mention detection
try {
  const me = await bot.api.getMe()
  botUsername = me.username ?? ""
  console.log(`Bot username: @${botUsername}`)
} catch (e) {
  console.error("Failed to get bot info:", e)
}

// Poll for approved pairings
pollApproved(bot)

// Subscribe to opencode events for tool updates
;(async () => {
  const events = await opencode.client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.type === "tool" && part.state.status === "completed") {
        // Find chat for this session and send tool update
        for (const [chatId, sessionId] of chatSessions.entries()) {
          if (sessionId === part.sessionID) {
            const toolMsg = `🔧 ${part.tool} — ${part.state.title ?? "done"}`
            await bot.api.sendMessage(chatId, toolMsg).catch(() => {})
            break
          }
        }
      }
    }
  }
})()

// Handle messages
async function handleMessage(ctx: Context, text: string) {
  const gateResult = gate(ctx)
  const chatId = String(ctx.chat?.id ?? "")
  const senderId = String(ctx.from?.id ?? "")

  if (gateResult === "deny") return
  if (gateResult === "pair") {
    const msg = handlePairing(senderId, chatId)
    await ctx.reply(msg).catch(() => {})
    return
  }

  // Get or create session
  let sessionId = chatSessions.get(chatId)
  if (!sessionId) {
    const username = ctx.from?.username ?? ctx.from?.first_name ?? "unknown"
    const chatTitle =
      ctx.chat?.type === "private"
        ? `Telegram DM: ${username}`
        : `Telegram: ${(ctx.chat as any)?.title ?? chatId}`

    const result = await opencode.client.session.create({
      body: { title: chatTitle },
    })
    if (result.error) {
      await ctx.reply("Failed to create session. Please try again.").catch(() => {})
      return
    }
    sessionId = result.data.id
    chatSessions.set(chatId, sessionId)
  }

  // Format message with metadata (like Claude Code's <channel> tag)
  const username = ctx.from?.username ?? ctx.from?.first_name ?? "unknown"
  const ts = new Date().toISOString()
  const msgId = ctx.message?.message_id
  const prompt = `<channel source="telegram" chat_id="${chatId}" message_id="${msgId}" user="${username}" user_id="${senderId}" ts="${ts}">\n${text}\n</channel>`

  // Send to opencode
  const result = await opencode.client.session.prompt({
    path: { id: sessionId },
    body: { parts: [{ type: "text", text: prompt }] },
  })

  if (result.error) {
    await ctx.reply("Failed to process message. Please try again.").catch(() => {})
    return
  }

  // Extract response text
  const response = result.data
  const responseText =
    response.info?.content ||
    response.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") ||
    ""

  if (!responseText) return

  // Split long messages (Telegram 4096 char limit)
  const chunks = splitMessage(responseText, 4096)
  for (const chunk of chunks) {
    await ctx.reply(chunk, { reply_to_message_id: msgId }).catch(() => {})
  }
}

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }
    // Try to split at newline
    let splitAt = remaining.lastIndexOf("\n", limit)
    if (splitAt < limit / 2) splitAt = limit
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }
  return chunks
}

// Register handlers
bot.on("message:text", (ctx) => handleMessage(ctx, ctx.message.text))
bot.on("message:photo", (ctx) => handleMessage(ctx, ctx.message.caption ?? "(photo)"))
bot.on("message:document", (ctx) => handleMessage(ctx, ctx.message.caption ?? `(document: ${ctx.message.document.file_name ?? "file"})`))
bot.on("message:voice", (ctx) => handleMessage(ctx, ctx.message.caption ?? "(voice message)"))
bot.on("message:video", (ctx) => handleMessage(ctx, ctx.message.caption ?? "(video)"))
bot.on("message:sticker", (ctx) => {
  const emoji = ctx.message.sticker.emoji ? ` ${ctx.message.sticker.emoji}` : ""
  return handleMessage(ctx, `(sticker${emoji})`)
})

// Start bot
bot.catch((err) => {
  console.error("Bot error:", err)
})

await bot.start({
  onStart: () => console.log(`Telegram bot @${botUsername} is running!`),
})
