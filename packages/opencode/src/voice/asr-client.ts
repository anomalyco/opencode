export interface TranscriptSegment {
  text: string
  is_final: boolean
  metadata?: {
    emotion?: string
    intent?: string
    gender?: string
    age?: string
  }
  metadata_probs?: {
    emotion?: Array<{ token: string; probability: number }>
    intent?: Array<{ token: string; probability: number }>
  }
  speech_rate?: {
    words_per_minute: number
    filler_count: number
    filler_rate: number
    pause_count: number
  }
}

export class AsrStreamClient {
  private ws: WebSocket | null = null
  private url: string
  private language: string
  private sampleRate: number
  private endResolve: (() => void) | null = null

  onTranscript: ((seg: TranscriptSegment) => void) | null = null
  onError: ((err: Error) => void) | null = null

  private token: string

  constructor(opts?: { url?: string; language?: string; sampleRate?: number; token?: string }) {
    const base = opts?.url ?? process.env.WHISSLE_ASR_URL ?? "wss://api.whissle.ai/asr/stream"
    this.token = opts?.token ?? process.env.WHISSLE_AUTH_TOKEN ?? ""
    this.url = this.token ? `${base}?token=${encodeURIComponent(this.token)}` : base
    this.language = opts?.language ?? process.env.WHISSLE_ASR_LANGUAGE ?? "en"
    this.sampleRate = opts?.sampleRate ?? 16000
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve()
        return
      }

      const ws = new WebSocket(this.url)
      ws.binaryType = "arraybuffer"

      const timeout = setTimeout(() => {
        reject(new Error("Voice server connection timed out"))
        try {
          ws.close()
        } catch {}
      }, 10_000)

      ws.addEventListener("open", () => {
        clearTimeout(timeout)
        this.ws = ws
        this.sendConfig()
        resolve()
      })

      ws.addEventListener("message", (ev: MessageEvent) => {
        if (typeof ev.data !== "string") return
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === "transcript") {
            this.onTranscript?.({
              text: msg.text ?? "",
              is_final: msg.is_final !== false,
              metadata: msg.metadata,
              metadata_probs: msg.metadata_probs,
              speech_rate: msg.speech_rate,
            })
          } else if (msg.type === "end") {
            this.endResolve?.()
            this.endResolve = null
            this.close()
          } else if (msg.type === "error") {
            this.onError?.(new Error(msg.message ?? "ASR error"))
          }
        } catch {}
      })

      ws.addEventListener("error", () => {
        clearTimeout(timeout)
        const err = new Error("Voice server connection failed")
        reject(err)
        this.onError?.(err)
      })

      ws.addEventListener("close", () => {
        clearTimeout(timeout)
        this.endResolve?.()
        this.endResolve = null
        this.ws = null
      })
    })
  }

  private sendConfig(): void {
    this.ws?.send(
      JSON.stringify({
        type: "config",
        language: this.language,
        use_lm: true,
        sample_rate: this.sampleRate,
        metadata_prob: true,
        word_timestamps: true,
      }),
    )
  }

  sendPcm(pcm: Buffer): void {
    if (!this.connected || !this.ws) return
    const ab = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
    this.ws.send(ab)
  }

  end(): Promise<void> {
    if (!this.connected || !this.ws) return Promise.resolve()
    return new Promise((resolve) => {
      this.endResolve = resolve
      this.ws!.send(JSON.stringify({ type: "end" }))
      setTimeout(() => {
        this.endResolve?.()
        this.endResolve = null
        this.close()
      }, 5_000)
    })
  }

  close(): void {
    try {
      this.ws?.close()
    } catch {}
    this.ws = null
  }
}
