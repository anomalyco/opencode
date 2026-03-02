import { createOpencodeClient } from "@opencode-ai/sdk"
import { spawn } from "child_process"
import { TelegramAdapter } from "./adapters/telegram"
import { SessionManager } from "./session"
import { MediaHandler } from "./media"
import { AuthHandler } from "./auth"
import { CommandHandler } from "./commands"
import { QuestionHandler } from "./questions"
import fs from "fs/promises"
import path from "path"

interface IMConfig {
  type: "telegram" | "slack" | "whatsapp" | "discord" | "disabled"
  token?: string
  enabled?: boolean
  maxFileSize?: number
  allowedTypes?: string[]
  storagePath?: string
  cleanupDays?: number
  allowedUsers?: number[]
}

interface Config {
  im?: IMConfig
  projects?: Record<string, { name: string; directory: string }>
  _configPath?: string
}

async function loadConfig(): Promise<Config> {
  const homeDir = process.env.HOME || require("os").homedir()
  const configPaths = [path.join(homeDir, ".opencode", ".opencode.json"), path.join(process.cwd(), ".opencode.json")]

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, "utf-8")
      const config = JSON.parse(content)
      console.log(`📋 Config loaded from: ${configPath}`)
      return { ...config, _configPath: configPath }
    } catch {
      continue
    }
  }

  console.log("⚠️  No config file found, using defaults")
  const defaultPath = path.join(homeDir, ".opencode", ".opencode.json")
  return { _configPath: defaultPath }
}

async function saveConfig(config: Config): Promise<void> {
  const configPath =
    (config as any)._configPath || path.join(process.env.HOME || require("os").homedir(), ".opencode", ".opencode.json")
  const { _configPath, ...configToSave } = config as any
  await fs.writeFile(configPath, JSON.stringify(configToSave, null, 2))
  console.log(`💾 Config saved to: ${configPath}`)
}

export class IMManager {
  private adapter: any | null = null
  private client: ReturnType<typeof createOpencodeClient>
  private sessionManager: SessionManager | null = null
  private commandHandler: CommandHandler | null = null
  private questionHandler: QuestionHandler | null = null
  private mediaHandler: MediaHandler | null = null
  private authHandler: AuthHandler | null = null
  private config: Config = {}

  async initialize(): Promise<void> {
    this.config = await loadConfig()
    console.log("🔧 IM Config loaded:")
    console.log("  - projects:", Object.keys(this.config.projects || {}).join(", "))
    console.log("  - im type:", this.config.im?.type)
    console.log("  - full config:", JSON.stringify(this.config, null, 2))

    if (!this.config.im || this.config.im.type === "disabled") {
      console.log("ℹ️  IM integration is disabled")
      return
    }

    // Try connecting to server, retry if needed
    const maxRetries = 5
    let connected = false
    const projects = this.config.projects || {}
    const defaultProjectDir = Object.keys(projects).length > 0 ? Object.values(projects)[0].directory : process.cwd()

    for (let i = 0; i < maxRetries; i++) {
      try {
        const apiUrl = process.env.OPENCODE_API_URL || "http://localhost:4096"
        console.log(`🔄 Connecting to opencode server on ${apiUrl}... (attempt ${i + 1}/${maxRetries})`)
        const customFetch = async (req: any) => {
          req.timeout = false
          return await fetch(req)
        }
        this.client = createOpencodeClient({
          baseUrl: apiUrl,
          directory: defaultProjectDir,
          fetch: customFetch,
        })
        console.log("✅ Connected to opencode server, default directory:", defaultProjectDir)
        connected = true
        break
      } catch (error) {
        console.log(`⚠️  Connection attempt ${i + 1} failed:`, (error as Error).message)
        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
    }

    if (!connected) {
      throw new Error("Failed to connect to opencode server after multiple attempts")
    }

    this.sessionManager = new SessionManager(this.client, this.config)
    this.authHandler = new AuthHandler(this.config)

    switch (this.config.im.type) {
      case "telegram":
        this.adapter = new TelegramAdapter(this.config.im)
        break
      case "slack":
        console.log("⚠️  Slack adapter not yet implemented")
        return
      default:
        throw new Error(`Unknown IM type: ${this.config.im?.type}`)
    }

    this.mediaHandler = new MediaHandler(this.adapter, this.client, this.sessionManager, this.config)

    this.commandHandler = new CommandHandler(this.sessionManager, this.adapter, this.config)
    this.commandHandler.setOnConfigUpdate(async () => {
      await saveConfig(this.config)
      this.sessionManager = new SessionManager(this.client, this.config)
    })

    this.questionHandler = new QuestionHandler(this.adapter, this.client)

    await this.mediaHandler.initialize()
    console.log("📱 Media handler initialized, initializing adapter...")
    await this.adapter.initialize()
    console.log("📱 Adapter initialized, registering handlers...")

    this.adapter.onMessage(this.handleMessage.bind(this))
    this.adapter.onToolUpdate(this.handleToolUpdate.bind(this))

    console.log("📱 Handlers registered, subscribing to events...")
    await this.subscribeToEvents()
    console.log("📱 Events subscribed, initialize() complete!")
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
    const chatId = message.chatId
    console.log("\n" + "═".repeat(50))
    console.log("📥 收到消息 from", chatId + ":", message.text || "[媒体消息]")
    console.log("📥 消息对象 keys:", Object.keys(message))
    console.log("📥 photo:", !!message.photo, "document:", !!message.document)
    console.log("═".repeat(50))

    const userId = message.userId
    if (userId && !this.authHandler.isAllowed(parseInt(userId))) {
      await this.authHandler.handleUnauthorized(chatId, parseInt(userId), this.adapter)
      return
    }

    if (message.photo || message.document || message.audio || message.video || message.voice || message.video_note) {
      console.log("📎 检测到媒体消息，调用 mediaHandler...")
      await this.adapter.sendMessage(chatId, "✅ 收到图片，正在分析...")
      await this.mediaHandler.handleMedia(message)
      console.log("📎 媒体处理完成")
      return
    }

    await this.adapter.sendMessage(chatId, "✅ 收到消息，正在处理...")

    console.log("🤖 [AI] 获取 session...")
    const session = await this.sessionManager.getOrCreateSession(chatId)
    console.log("🤖 [AI] Session ID:", session.sessionId)

    const projects = this.sessionManager.getProjects()
    const currentProject = this.sessionManager.getCurrentProject()
    const text = message.text || ""

    console.log("🤖 [AI] 当前项目:", currentProject)
    console.log("🤖 [AI] 可用项目:", Object.keys(projects))

    let targetProject = currentProject

    for (const [key, project] of Object.entries(projects)) {
      if (text.includes(key) || text.includes(project.name)) {
        targetProject = { key, name: project.name, directory: project.directory }
        console.log("🤖 [AI] 检测到项目切换:", key, "->", targetProject.name)
        break
      }
    }

    if (targetProject.key !== currentProject.key) {
      console.log("🤖 [AI] 执行项目切换:", targetProject.name)
      await this.sessionManager.switchProject(chatId, targetProject.directory!)
      const newSession = await this.sessionManager.getOrCreateSession(chatId)
      console.log("🤖 [AI] 已切换到项目:", targetProject.name)
      console.log("🤖 [AI] 新 Session ID:", newSession.sessionId)
    }

    let systemContext = ""
    if (Object.keys(projects).length > 0) {
      const projectList = Object.entries(projects)
        .map(([key, project]) => `- ${key} (${project.name}): ${project.directory}`)
        .join("\n")
      systemContext = `\n\n[项目信息]\n可用项目:\n${projectList}\n当前项目: ${targetProject.name || "未设置"} (${targetProject.directory || "未设置"})\n\n你的工作目录是: ${targetProject.directory}`
    }

    console.log("🤖 [AI] 发送消息到模型:", text)
    console.log("🤖 [AI] Session ID:", session.sessionId)
    console.log("🤖 [AI] 完整消息内容:", JSON.stringify({ text: text + systemContext }, null, 2))

    let sessionIdToUse = session.sessionId
    if (targetProject.key !== currentProject.key) {
      const newSession = await this.sessionManager.getOrCreateSession(chatId)
      sessionIdToUse = newSession.sessionId
    }

    const result = await this.client.session.prompt({
      path: {
        id: sessionIdToUse,
      },
      body: { parts: [{ type: "text", text: text + systemContext }] },
    })

    console.log("🤖 [AI] 收到响应，result.error:", !!result.error, "result.data:", !!result.data)
    console.log("🤖 [AI] 完整result:", JSON.stringify(result, null, 2))

    if (result.error) {
      console.log("🤖 [AI] 错误:", result.error)
      const errorMsg = (result.error as any).message || String(result.error)
      await this.adapter.sendMessage(chatId, `❌ 错误: ${errorMsg}`)
      return
    }

    const response = this.formatResponse(result.data)
    console.log("🤖 [AI] 响应内容:", response.substring(0, 200))
    console.log("📤 发送回复 to", chatId + ":", response.substring(0, 100) + "...")
    console.log("═".repeat(50) + "\n")
    await this.adapter.sendMessage(chatId, response)
  }

  private async handleToolUpdate(update: any): Promise<void> {
    console.log("🔧 [ToolUpdate] 收到工具更新:", JSON.stringify(update, null, 2))
    const session = this.sessionManager.getSessionBySessionId(update.sessionId)
    if (!session) {
      console.log("⚠️ [ToolUpdate] 未找到对应 session:", update.sessionId)
      return
    }

    const title = update.title || "执行中"
    const status = update.status || "pending"
    const message = `✅ *${update.tool}* - ${title} (${status})`
    console.log("📤 [ToolUpdate] 发送消息到", session.chatId, ":", message)
    await this.adapter.sendMessage(session.chatId, message)
  }

  private async subscribeToEvents(): Promise<void> {
    console.log("📱 Starting event subscription...")
    this.subscribeToEventsInternal().catch((err) => {
      console.error("📱 Event subscription error:", err.message)
    })
  }

  private async subscribeToEventsInternal(): Promise<void> {
    const events = await this.client.event.subscribe()
    console.log("📱 [Events] 开始订阅事件流...")

    for await (const event of events.stream) {
      console.log("📱 [Events] 收到事件:", event.type, JSON.stringify(event.properties, null, 2))
      if (event.type === "session.compacted") {
        await this.handleSessionCompacted(event.properties.sessionID)
      } else if (event.type === "message.part.updated") {
        const part = event.properties.part
        console.log("🔧 [Events] 工具 part:", JSON.stringify(part, null, 2))
        if (part.type === "tool") {
          console.log("🔧 [Events] 工具状态:", part.state)
          console.log("🔧 [Events] 工具 title:", part.state?.title)
          console.log("🔧 [Events] 工具 status:", part.state?.status)
          await this.handleToolUpdate({
            sessionId: part.sessionID,
            tool: part.tool,
            title: (part.state as any).title,
            status: (part.state as any).status,
          })
        }
      }
    }
  }

  private async handleSessionCompacted(sessionId: string): Promise<void> {
    if (!this.config.compaction?.notify) return

    this.sessionManager.updateCompaction(sessionId)

    const session = this.sessionManager.getSessionBySessionId(sessionId)
    if (!session) return

    const stats = this.sessionManager.getStats(session.chatId)

    const message = `🗜️ *会话已压缩*\n\n💬 消息数: ${stats.messageCount}\n📎 媒体数: ${stats.mediaCount}\n📦 压缩时间: ${new Date(stats.compactedAt!).toLocaleString("zh-CN")}\n🔄 新会话已创建，可以继续对话`

    await this.adapter.sendMessage(session.chatId, message)
  }

  private formatResponse(data: any): string {
    console.log("📋 [FormatResponse] 原始数据:", JSON.stringify(data, null, 2))
    if (data.info?.content) {
      console.log("📋 [FormatResponse] 使用 info.content:", data.info.content.substring(0, 100))
      return data.info.content
    }

    if (data.parts) {
      const textParts = data.parts.filter((p: any) => p.type === "text")
      const text = textParts.map((p: any) => p.text).join("\n")
      console.log("📋 [FormatResponse] 使用 parts, 文本长度:", text.length)
      return text
    }

    console.log("📋 [FormatResponse] 无响应数据")
    return "(无响应)"
  }
}
