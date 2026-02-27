import { Config } from "@opencode-ai/config"
import { TelegramAdapter } from "./adapters/telegram"
import { SessionManager } from "./session"
import { MediaHandler } from "./media"
import { AuthHandler } from "./auth"
import { CommandHandler } from "./commands"
import { QuestionHandler } from "./questions"

export class IMManager {
  private adapter: any | null = null
  private opencode: Awaited<ReturnType<typeof createOpencode>>
  private sessionManager: SessionManager | null = null
  private commandHandler: CommandHandler | null = null
  private questionHandler: QuestionHandler | null = null
  private mediaHandler: MediaHandler | null = null
  private authHandler: AuthHandler | null = null

  async initialize(): Promise<void> {
    const config = await Config.get()

    if (!config.im || config.im.type === "disabled") {
      console.log("ℹ️  IM integration is disabled")
      return
    }

    this.opencode = await createOpencode({ port: 4096 })

    this.sessionManager = new SessionManager(this.opencode, config)
    this.authHandler = new AuthHandler(config)

    switch (config.im.type) {
      case "telegram":
        this.adapter = new TelegramAdapter(config.im)
        break
      case "slack":
        console.log("⚠️  Slack adapter not yet implemented")
        return
      default:
        throw new Error(`Unknown IM type: ${config.im.type}`)
    }

    this.mediaHandler = new MediaHandler(this.adapter, this.opencode, this.sessionManager, config)

    this.commandHandler = new CommandHandler(this.sessionManager, this.adapter, config)

    this.questionHandler = new QuestionHandler(this.adapter, this.opencode)

    await this.mediaHandler.initialize()
    await this.adapter.initialize()

    this.adapter.onMessage(this.handleMessage.bind(this))
    this.adapter.onToolUpdate(this.handleToolUpdate.bind(this))

    await this.subscribeToEvents()
  }

  async start(): Promise<void> {
    if (this.adapter) {
      await this.adapter.start()
      console.log("🚀 IM integration started")
    }
  }

  async stop(): Promise<void> {
    if (this.adapter) {
      await this.adapter.stop()
      console.log("🛑 IM integration stopped")
    }
  }

  private async handleMessage(message: any): Promise<void> {
    const userId = message.from?.id
    if (userId && !this.authHandler.isAllowed(userId)) {
      await this.authHandler.handleUnauthorized(message.chat.id, userId, this.adapter)
      return
    }

    if (message.photo || message.document || message.audio || message.video || message.voice || message.video_note) {
      await this.mediaHandler.handleMedia(message)
      return
    }

    const session = await this.sessionManager.getOrCreateSession(message.chat.id)

    const result = await this.opencode.client.session.prompt({
      path: { id: session.sessionId },
      body: { parts: [{ type: "text", text: message.text || "" }] },
    })

    if (result.error) {
      await this.adapter.sendMessage(message.chat.id, `❌ 错误: ${result.error.message}`)
      return
    }

    const response = this.formatResponse(result.data)
    await this.adapter.sendMessage(message.chat.id, response)
  }

  private async handleToolUpdate(update: any): Promise<void> {
    const session = this.sessionManager.getSessionBySessionId(update.sessionId)
    if (!session) return

    const message = `✅ *${update.tool}* - ${update.title}`
    await this.adapter.sendMessage(session.chatId, message)
  }

  private async subscribeToEvents(): Promise<void> {
    const events = await this.opencode.client.event.subscribe()

    for await (const event of events.stream) {
      if (event.type === "session.compacted") {
        await this.handleSessionCompacted(event.properties.sessionID)
      } else if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.type === "tool") {
          await this.handleToolUpdate({
            sessionId: part.sessionID,
            tool: part.tool,
            title: part.state.title,
            status: part.state.status,
          })
        }
      }
    }
  }

  private async handleSessionCompacted(sessionId: string): Promise<void> {
    const config = await Config.get()
    if (!config.compaction?.notify) return

    this.sessionManager.updateCompaction(sessionId)

    const session = this.sessionManager.getSessionBySessionId(sessionId)
    if (!session) return

    const stats = this.sessionManager.getStats(session.chatId)

    const message = `🗜️ *会话已压缩*\n\n💬 消息数: ${stats.messageCount}\n📎 媒体数: ${stats.mediaCount}\n📦 压缩时间: ${new Date(stats.compactedAt!).toLocaleString("zh-CN")}\n🔄 新会话已创建，可以继续对话`

    await this.adapter.sendMessage(session.chatId, message)
  }

  private formatResponse(data: any): string {
    if (data.info?.content) {
      return data.info.content
    }

    if (data.parts) {
      const textParts = data.parts.filter((p: any) => p.type === "text")
      const text = textParts.map((p: any) => p.text).join("\n")
      return text
    }

    return "(无响应)"
  }
}
