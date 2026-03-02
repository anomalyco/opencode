import TelegramBot from "node-telegram-bot-api"
import type {
  IMAdapter,
  IMMessage,
  MessageOptions,
  Question,
  QuestionResponse,
  CommandHandler,
  ToolUpdateCallback,
  InlineKeyboard,
} from "./adapter"

export type MediaType = "photo" | "document" | "audio" | "video" | "voice" | "video_note"

export class TelegramAdapter implements IMAdapter {
  readonly type = "telegram"
  readonly name = "Telegram"

  private bot: TelegramBot
  private messageCallback: ((message: IMMessage) => void) | null = null
  private toolUpdateCallback: ((update: any) => void) | null = null
  private commandHandlers = new Map<string, CommandHandler>()

  constructor(private config: TelegramConfig) {
    console.log("🤖 Creating Telegram bot with token:", config.token?.substring(0, 10) + "...")
    this.bot = new TelegramBot(config.token, { polling: true })
    console.log("🤖 Telegram bot created, waiting for initialization...")

    this.bot.on("polling_error", (error) => {
      console.error("🤖 Telegram polling error:", error.message)
    })
  }

  async initialize(): Promise<void> {
    console.log("🤖 Setting up Telegram bot commands...")
    await this.bot.setMyCommands([
      { command: "switch_project", description: "切换到指定项目" },
      { command: "list_projects", description: "列出所有项目" },
      { command: "new_project", description: "添加新项目" },
      { command: "list_directories", description: "列出可用目录" },
      { command: "reset_session", description: "重置当前会话" },
      { command: "session_info", description: "显示当前会话信息" },
      { command: "help", description: "显示帮助" },
    ])
    console.log("🤖 Telegram commands set up")

    this.bot.on("message", this.handleMessage.bind(this))
    this.bot.on("callback_query", this.handleCallbackQuery.bind(this))
  }

  async start(): Promise<void> {
    console.log("🤖 Telegram adapter start() called")
    console.log(`✅ ${this.name} adapter started`)
  }

  async stop(): Promise<void> {
    await this.bot.stopPolling()
    console.log(`🛑 ${this.name} adapter stopped`)
  }

  onMessage(callback: (message: IMMessage) => void): void {
    this.messageCallback = callback
  }

  onToolUpdate(callback: (update: any) => void): void {
    this.toolUpdateCallback = callback
  }

  async sendMessage(chatId: string, text: string, options?: MessageOptions): Promise<void> {
    await this.bot.sendMessage(chatId, text, {
      parse_mode: options?.parseMode || "Markdown",
      reply_markup: options?.replyMarkup,
    })
  }

  async presentQuestion(chatId: string, question: Question): Promise<QuestionResponse> {
    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        ...question.options.map((opt) => [
          {
            text: opt.label,
            callback_data: `q:${question.id}:${opt.label}`,
          },
        ]),
        [{ text: "❌ 拒绝", callback_data: `q:${question.id}:reject` }],
      ],
    }

    const message = `🤔 *${question.header}*\n\n${question.text}`
    await this.bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    })

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ answered: false })
      }, 60000)

      this.bot.once("callback_query", (query) => {
        if (query.data?.startsWith(`q:${question.id}:`)) {
          clearTimeout(timeout)
          const data = query.data.split(":")[2]

          if (data === "reject") {
            resolve({ answered: true, rejected: true })
          } else {
            resolve({ answered: true, answers: [data] })
          }

          this.bot.answerCallbackQuery(query.id)
          this.bot.editMessageReplyMarkup(query.message.chat.id, query.message.message_id, { inline_keyboard: [] })
        }
      })
    })
  }

  registerCommand(command: string, handler: CommandHandler): void {
    this.commandHandlers.set(command, handler)
  }

  getFile(fileId: string): Promise<any> {
    return this.bot.getFile(fileId)
  }

  async sendPhoto(chatId: string, source: string, options?: any): Promise<void> {
    await this.bot.sendPhoto(chatId, source, options)
  }

  async sendDocument(chatId: string, source: string, options?: any): Promise<void> {
    await this.bot.sendDocument(chatId, source, options)
  }

  async sendFileParts(chatId: string, parts: any[]): Promise<void> {
    const mediaGroup: any[] = []

    for (const part of parts) {
      if (part.type === "image") {
        mediaGroup.push({
          type: "photo",
          media: part.url,
          caption: part.filename,
        })
      } else {
        mediaGroup.push({
          type: "document",
          media: part.url,
          caption: part.filename,
        })
      }
    }

    if (mediaGroup.length > 1) {
      await this.bot.sendMediaGroup(chatId, mediaGroup)
    } else if (mediaGroup.length === 1) {
      const item = mediaGroup[0]
      if (item.type === "photo") {
        await this.bot.sendPhoto(chatId, item.media, { caption: item.caption })
      } else {
        await this.bot.sendDocument(chatId, item.media, { caption: item.caption })
      }
    }
  }

  private async handleMessage(msg: TelegramBot.Message): Promise<void> {
    console.log("📩 Telegram message received:", msg.text, "from:", msg.from?.id, "chat:", msg.chat.id)
    console.log("📩 Has photo:", !!msg.photo, "document:", !!msg.document)

    if (msg.text?.startsWith("/")) {
      const [command, ...args] = msg.text.split(" ")
      console.log("📩 Command:", command, "args:", args)
      const handler = this.commandHandlers.get(command)
      if (handler) {
        await handler(msg.chat.id.toString(), args, msg)
      }
      return
    }

    if (msg.photo || msg.document || msg.audio || msg.video || msg.voice || msg.video_note) {
      if (this.messageCallback) {
        await this.messageCallback({
          id: msg.message_id.toString(),
          chatId: msg.chat.id.toString(),
          text: msg.text || "",
          userId: msg.from?.id.toString(),
          photo: msg.photo,
          document: msg.document,
          audio: msg.audio,
          video: msg.video,
          voice: msg.voice,
          video_note: msg.video_note,
        })
      }
      return
    }

    if (msg.text && this.messageCallback) {
      await this.messageCallback({
        id: msg.message_id.toString(),
        chatId: msg.chat.id.toString(),
        text: msg.text || "",
        userId: msg.from?.id.toString(),
      })
    }
  }

  private async handleCallbackQuery(query: any): Promise<void> {
    await this.bot.answerCallbackQuery(query.id)
  }
}

export interface TelegramConfig {
  token: string
  allowedUsers?: number[]
}
