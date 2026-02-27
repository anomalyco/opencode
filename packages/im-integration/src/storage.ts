import path from "path"
import fs from "fs/promises"
import { randomUUID } from "crypto"
import { Config } from "@opencode-ai/config"

const MAX_FILE_SIZE = 20 * 1024 * 1024

export class MediaStorage {
  private storagePath: string
  private cleanupDays: number

  constructor(private config: any) {
    this.storagePath = this.resolvePath(config.im?.storagePath || "~/.opencode/im-media")
    this.cleanupDays = config.im?.cleanupDays || 15
  }

  private resolvePath(p: string): string {
    if (p.startsWith("~")) {
      return path.join(process.env.HOME || "", p.slice(1))
    }
    return p
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true })
    this.startCleanupScheduler()
    console.log(`📂 Media storage initialized: ${this.storagePath}`)
  }

  async saveFile(
    fileId: string,
    mimeType: string,
    data: Buffer,
  ): Promise<{ path: string; filename: string; size: number }> {
    if (data.length > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${data.length} bytes (max: ${MAX_FILE_SIZE})`)
    }

    const ext = this.getExtension(mimeType)
    const filename = `${fileId}_${randomUUID()}.${ext}`
    const filePath = path.join(this.storagePath, filename)

    await fs.writeFile(filePath, data)

    return {
      path: filePath,
      filename,
      size: data.length,
    }
  }

  async saveFromUrl(
    fileId: string,
    url: string,
    mimeType: string,
  ): Promise<{ path: string; filename: string; size: number }> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return this.saveFile(fileId, mimeType, buffer)
  }

  getFilePath(filename: string): string {
    return path.join(this.storagePath, filename)
  }

  async deleteFile(filename: string): Promise<void> {
    const filePath = path.join(this.storagePath, filename)
    await fs.unlink(filePath).catch(() => {})
  }

  private startCleanupScheduler(): void {
    setInterval(
      async () => {
        const deleted = await this.cleanup(this.cleanupDays)
        if (deleted > 0) {
          console.log(`🧹 Cleaned up ${deleted} media files`)
        }
      },
      24 * 60 * 60 * 1000,
    )
  }

  async cleanup(olderThanDays: number): Promise<number> {
    const files = await fs.readdir(this.storagePath)
    const now = Date.now()
    let deleted = 0

    for (const filename of files) {
      const filePath = path.join(this.storagePath, filename)
      const stat = await fs.stat(filePath)
      const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)

      if (ageDays > olderThanDays) {
        await fs.unlink(filePath)
        deleted++
      }
    }

    return deleted
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "application/pdf": "pdf",
      "application/zip": "zip",
      "text/plain": "txt",
      "application/json": "json",
      "audio/mpeg": "mp3",
      "audio/ogg": "ogg",
      "video/mp4": "mp4",
    }
    return map[mimeType] || "bin"
  }

  isAllowedType(mimeType: string): boolean {
    const allowed = this.config.im?.allowedTypes
    if (!allowed || allowed.length === 0) return true

    return allowed.some((type) => {
      if (type.endsWith("/*")) {
        const prefix = type.slice(0, -1)
        return mimeType.startsWith(prefix)
      }
      return mimeType === type
    })
  }
}
