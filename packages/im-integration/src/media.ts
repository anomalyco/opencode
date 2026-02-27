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
    private opencode: any,
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
    const chatId = msg.chat.id

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
      const fileBuffer = await this.downloadFile(mediaInfo)

      const saved = await this.storage.saveFile(mediaInfo.fileId, mediaInfo.mimeType, fileBuffer)

      await this.sendToOpencode(chatId, mediaInfo, saved.path)

      this.sessionManager.incrementMediaCount(chatId)
    } catch (error) {
      await this.adapter.sendMessage(chatId, `❌ 处理文件失败: ${(error as Error).message}`)
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
    const session = await this.sessionManager.getOrCreateSession(chatId)

    const opencodeType = info.type === "photo" ? "image" : "file"

    const text = this.formatDescription(info)

    const result = await this.opencode.client.session.prompt({
      path: { id: session.sessionId },
      body: {
        parts: [
          { type: "text", text },
          {
            type: opencodeType,
            url: `file://${localPath}`,
            mime: info.mimeType,
            filename: info.filename,
          },
        ],
      },
    })

    if (result.error) {
      throw new Error(result.error.message)
    }

    await this.sendResponse(chatId, result.data)
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

    return `${emoji[info.type]} 用户发送了: ${name} (${size} MB)`
  }

  private async sendResponse(chatId: string, data: any): Promise<void> {
    const textParts = data.parts?.filter((p: any) => p.type === "text") || []
    const mediaParts = data.parts?.filter((p: any) => p.type === "file" || p.type === "image") || []

    if (textParts.length > 0) {
      const text = textParts.map((p: any) => p.text).join("\n")
      await this.adapter.sendMessage(chatId, text)
    }

    for (const part of mediaParts) {
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
  }
}
