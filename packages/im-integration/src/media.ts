import type { MediaType } from "./adapters/telegram"
import { MediaStorage } from "./storage"

export interface MediaInfo {
  type: MediaType
  fileId: string
  mimeType: string
  filename?: string
  fileSize: number
}

export class MediaHandler {
  constructor(
    private adapter: any,
    private client: any,
    private sessionManager: any,
    private config: any,
  ) {
    this.storage = new MediaStorage(config)
  }

  private storage: MediaStorage

  async initialize(): Promise<void> {
    await this.storage.initialize()
  }

  async handleMedia(msg: any): Promise<void> {
    const chatId = msg.chatId || msg.chat?.id
    console.log("📎 [Media] chatId:", chatId, "msg:", JSON.stringify(msg).substring(0, 100))

    const mediaInfo = this.extractMediaInfo(msg)
    if (!mediaInfo) return

    if (mediaInfo.fileSize > 20 * 1024 * 1024) {
      await this.adapter.sendMessage(
        chatId,
        `❌ 文件太大！最大支持 20MB，当前: ${(mediaInfo.fileSize / 1024 / 1024).toFixed(2)}MB`,
      )
      return
    }

    if (!this.storage.isAllowedType(mediaInfo.mimeType)) {
      await this.adapter.sendMessage(
        chatId,
        `❌ 不支持的文件类型: ${mediaInfo.mimeType}\n\n允许的类型:\n${this.config.im?.allowedTypes?.join(", ") || "无限制"}`,
      )
      return
    }

    try {
      console.log("📎 [Media] 开始处理媒体文件...")
      const fileBuffer = await this.downloadFile(mediaInfo)
      console.log("📎 [Media] 文件下载完成，大小:", fileBuffer.length)

      const saved = await this.storage.saveFile(mediaInfo.fileId, mediaInfo.mimeType, fileBuffer)
      console.log("📎 [Media] 文件保存完成，路径:", saved.path)

      await this.sendToOpencode(chatId, mediaInfo, saved.path)
      console.log("📎 [Media] 发送到 opencode 完成")

      this.sessionManager.incrementMediaCount(chatId)
    } catch (error) {
      console.log("📎 [Media] 错误:", (error as Error).message)
      await this.adapter.sendMessage(chatId, `❌ 处理文件失败: ${(error as Error).message}`)
    } finally {
      console.log("📎 [Media] 处理完成，发送结束标记")
    }
  }

  private extractMediaInfo(msg: any): MediaInfo | null {
    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1]
      return {
        type: "photo",
        fileId: photo.file_id,
        mimeType: "image/jpeg",
        fileSize: photo.file_size,
      }
    }

    if (msg.document) {
      return {
        type: "document",
        fileId: msg.document.file_id,
        mimeType: msg.document.mime_type || "application/octet-stream",
        filename: msg.document.file_name,
        fileSize: msg.document.file_size,
      }
    }

    if (msg.audio) {
      return {
        type: "audio",
        fileId: msg.audio.file_id,
        mimeType: msg.audio.mime_type || "audio/mpeg",
        filename: msg.audio.file_name,
        fileSize: msg.audio.file_size,
      }
    }

    if (msg.video) {
      return {
        type: "video",
        fileId: msg.video.file_id,
        mimeType: msg.video.mime_type || "video/mp4",
        filename: msg.video.file_name,
        fileSize: msg.video.file_size,
      }
    }

    if (msg.voice) {
      return {
        type: "voice",
        fileId: msg.voice.file_id,
        mimeType: "audio/ogg",
        fileSize: msg.voice.file_size,
      }
    }

    if (msg.video_note) {
      return {
        type: "video_note",
        fileId: msg.video_note.file_id,
        mimeType: "video/mp4",
        fileSize: msg.video_note.file_size,
      }
    }

    return null
  }

  private async downloadFile(info: MediaInfo): Promise<Buffer> {
    const file = await this.adapter.getFile(info.fileId)
    const url = `https://api.telegram.org/file/bot${this.config.im.token}/${file.file_path}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  private async sendToOpencode(chatId: string, info: MediaInfo, localPath: string): Promise<void> {
    console.log("📎 [Media] 获取 session...")
    const session = await this.sessionManager.getOrCreateSession(chatId)
    console.log("📎 [Media] Session ID:", session.sessionId)

    // 根据文件类型选择合适的模型
    let modelConfig = undefined
    if (info.type === "photo") {
      modelConfig = {
        providerID: "zai-coding-plan",
        modelID: "glm-4.6v",
      }
      console.log("📎 [Media] 使用图片模型: zai-coding-plan/glm-4.6v")
    } else if (info.type === "document") {
      modelConfig = {
        providerID: "opencode",
        modelID: "minimax-m2.5-free",
      }
      console.log("📎 [Media] 使用文档模型: opencode/minimax-m2.5-free")
    }

    const text = this.formatDescription(info)
    console.log("📎 [Media] 发送 prompt，文本:", text.substring(0, 50), "文件:", localPath)

    let result: any = null
    let useFallback = false

    const timeout = 60000 // 60 秒超时

    const promptWithTimeout = async (body: any) => {
      return Promise.race([
        this.client.session.prompt({
          path: { id: session.sessionId },
          body,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("处理超时，请稍后重试")), timeout)),
      ]).catch((error) => {
        console.log("📎 [Media] 调用失败或超时:", error.message)
        return { error: { message: error.message } }
      })
    }

    // 先尝试使用指定模型
    try {
      result = await promptWithTimeout({
        model: modelConfig,
        parts: [
          { type: "text", text },
          {
            type: "file",
            url: `file://${localPath}`,
            mime: info.mimeType,
            filename: info.filename || "image.jpg",
          },
        ],
      })

      console.log("📎 [Media] 指定模型 result:", JSON.stringify(result).substring(0, 200))

      if (result.error) {
        console.log("📎 [Media] 指定模型失败，尝试回退")
        useFallback = true
      }
    } catch (err) {
      console.log("📎 [Media] 指定模型调用异常:", (err as Error).message)
      useFallback = true
    }

    // 回退：使用默认模型
    if (useFallback || !result?.data) {
      console.log("📎 [Media] 使用默认模型...")
      try {
        result = await promptWithTimeout({
          parts: [
            { type: "text", text },
            {
              type: "file",
              url: `file://${localPath}`,
              mime: info.mimeType,
              filename: info.filename || "image.jpg",
            },
          ],
        })
        console.log("📎 [Media] 默认模型 result:", JSON.stringify(result).substring(0, 200))
      } catch (err) {
        console.log("📎 [Media] 默认模型也失败:", (err as Error).message)
        throw new Error("图片处理失败，请稍后重试")
      }
    }

    if (result.error && result.error.message) {
      throw new Error(result.error.message)
    }

    console.log("📎 [Media] 发送响应到 Telegram...")
    await this.sendResponse(chatId, result.data)
    console.log("📎 [Media] 响应发送完成")
  }

  private formatDescription(info: MediaInfo): string {
    const emoji: Record<MediaType, string> = {
      photo: "📷",
      document: "📄",
      audio: "🎵",
      video: "🎬",
      voice: "🎤",
      video_note: "🎥",
    }

    const size = (info.fileSize / 1024 / 1024).toFixed(2)
    const name = info.filename || `${info.type}`

    if (info.type === "photo") {
      return `用户发送了一张图片 "${name}" (${size} MB)。请分析这张图片并描述你看到的内容。`
    }
    return `${emoji[info.type]} 用户发送了文件: ${name} (${size} MB)`
  }

  private async sendResponse(chatId: string, data: any): Promise<void> {
    console.log("📎 [Media] sendResponse 收到的 data:", data ? JSON.stringify(data).substring(0, 300) : "undefined")

    if (!data) {
      await this.adapter.sendMessage(chatId, "✅ 图片已收到并分析完成")
      return
    }

    const textParts = data.parts?.filter((p: any) => p.type === "text") || []
    const mediaParts = data.parts?.filter((p: any) => p.type === "file" || p.type === "image") || []

    let hasContent = false

    if (textParts.length > 0) {
      const text = textParts.map((p: any) => p.text).join("\n")
      if (text.trim()) {
        await this.adapter.sendMessage(chatId, text)
        hasContent = true
      }
    }

    for (const part of mediaParts) {
      hasContent = true
      if (part.type === "image") {
        if (part.url?.startsWith("file://")) {
          const filePath = part.url.slice(7)
          await this.adapter.sendPhoto(chatId, filePath, { caption: part.filename })
        } else {
          await this.adapter.sendPhoto(chatId, part.url, { caption: part.filename })
        }
      } else {
        if (part.url?.startsWith("file://")) {
          const filePath = part.url.slice(7)
          await this.adapter.sendDocument(chatId, filePath, { caption: part.filename })
        } else {
          await this.adapter.sendDocument(chatId, part.url, { caption: part.filename })
        }
      }
    }

    if (!hasContent) {
      console.log("📎 [Media] 没有收到内容，发送默认结束消息")
      await this.adapter.sendMessage(chatId, "✅ 图片已收到并分析完成")
    }
  }
}
