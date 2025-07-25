export namespace BufferedWriter {
  export interface BufferConfig {
    bufferSize?: number
    flushInterval?: number
    autoFlush?: boolean
  }

  const DEFAULT_CONFIG: Required<BufferConfig> = {
    bufferSize: 50,
    flushInterval: 1000,
    autoFlush: true,
  }

  export class Writer {
    private buffer: string[] = []
    private flushTimer: Timer | null = null
    private config: Required<BufferConfig>
    private writer: BunFile["writer"] | null = null

    constructor(
      private filePath: string,
      config: BufferConfig = {}
    ) {
      this.config = { ...DEFAULT_CONFIG, ...config }
      this.setupCleanup()
    }

    async write(data: string): Promise<void> {
      if (!this.writer) {
        const file = Bun.file(this.filePath)
        this.writer = file.writer()
      }

      this.buffer.push(data)

      // Flush if buffer is full
      if (this.buffer.length >= this.config.bufferSize) {
        await this.flush()
      } else if (this.config.autoFlush && !this.flushTimer) {
        // Set up periodic flush
        this.flushTimer = setTimeout(() => this.flush(), this.config.flushInterval)
      }
    }

    async flush(): Promise<void> {
      if (this.buffer.length === 0 || !this.writer) {
        return
      }

      try {
        const data = this.buffer.join('')
        await this.writer.write(data)
        await this.writer.flush()
        this.buffer = []
      } catch (error) {
        console.error('Failed to flush buffer:', error)
      }

      if (this.flushTimer) {
        clearTimeout(this.flushTimer)
        this.flushTimer = null
      }
    }

    async close(): Promise<void> {
      await this.flush()
      
      if (this.writer) {
        await this.writer.end()
        this.writer = null
      }

      if (this.flushTimer) {
        clearTimeout(this.flushTimer)
        this.flushTimer = null
      }
    }

    private setupCleanup(): void {
      // Ensure buffer is flushed on process exit
      const cleanup = () => {
        this.flush().catch(console.error)
      }

      process.on('exit', cleanup)
      process.on('SIGINT', () => {
        cleanup()
        process.exit()
      })
      process.on('SIGTERM', cleanup)
      process.on('beforeExit', cleanup)
    }
  }

  export class Manager {
    private writers: Map<string, Writer> = new Map()

    getWriter(filePath: string, config?: BufferConfig): Writer {
      let writer = this.writers.get(filePath)
      
      if (!writer) {
        writer = new Writer(filePath, config)
        this.writers.set(filePath, writer)
      }

      return writer
    }

    async flushAll(): Promise<void> {
      const flushPromises = Array.from(this.writers.values()).map(writer => writer.flush())
      await Promise.all(flushPromises)
    }

    async closeAll(): Promise<void> {
      const closePromises = Array.from(this.writers.values()).map(writer => writer.close())
      await Promise.all(closePromises)
      this.writers.clear()
    }
  }
}