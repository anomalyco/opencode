export namespace StreamHandler {
  export interface StreamConfig {
    fileSizeThreshold?: number
    chunkSize?: number
  }

  const DEFAULT_CONFIG: Required<StreamConfig> = {
    fileSizeThreshold: 10 * 1024 * 1024, // 10MB
    chunkSize: 1024 * 1024, // 1MB
  }

  export class JsonStreamHandler {
    private config: Required<StreamConfig>

    constructor(config: StreamConfig = {}) {
      this.config = { ...DEFAULT_CONFIG, ...config }
    }

    async shouldStream(filePath: string): Promise<boolean> {
      try {
        const file = Bun.file(filePath)
        const stats = await file.stat()
        return stats.size > this.config.fileSizeThreshold
      } catch {
        return false
      }
    }

    async read<T>(filePath: string): Promise<T> {
      const file = Bun.file(filePath)
      
      if (await this.shouldStream(filePath)) {
        return this.readStream<T>(file)
      }
      
      return file.json() as Promise<T>
    }

    private async readStream<T>(file: BunFile): Promise<T> {
      const stream = file.stream()
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      
      let buffer = ''
      
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          buffer += decoder.decode(value, { stream: true })
        }
        
        // Final decode
        buffer += decoder.decode()
        return JSON.parse(buffer)
      } finally {
        reader.releaseLock()
      }
    }

    async write(filePath: string, content: any): Promise<void> {
      const jsonString = JSON.stringify(content, null, 2)
      
      if (jsonString.length > this.config.fileSizeThreshold) {
        await this.writeStream(filePath, jsonString)
      } else {
        await Bun.write(filePath, jsonString)
      }
    }

    private async writeStream(filePath: string, jsonString: string): Promise<void> {
      const file = Bun.file(filePath)
      const writer = file.writer()
      
      try {
        let offset = 0
        
        while (offset < jsonString.length) {
          const chunk = jsonString.slice(offset, offset + this.config.chunkSize)
          await writer.write(chunk)
          offset += this.config.chunkSize
        }
        
        await writer.flush()
      } finally {
        await writer.end()
      }
    }
  }

  export class AtomicFileWriter {
    constructor(private streamHandler: JsonStreamHandler) {}

    async write(targetPath: string, content: any): Promise<void> {
      const tmpPath = `${targetPath}.${Date.now()}.tmp`
      
      try {
        // Write to temporary file
        await this.streamHandler.write(tmpPath, content)
        
        // Atomic rename
        const fs = await import('fs/promises')
        await fs.rename(tmpPath, targetPath)
      } catch (error) {
        // Clean up temporary file on error
        try {
          const fs = await import('fs/promises')
          await fs.unlink(tmpPath)
        } catch {
          // Ignore cleanup errors
        }
        throw error
      }
    }
  }
}