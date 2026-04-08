import { MicCapture } from "./mic"
import { AsrStreamClient } from "./asr-client"

export type { TranscriptSegment } from "./asr-client"
export type { VoiceMetadata } from "./metadata"
export { VoiceMetadataStore } from "./metadata"

export class VoiceInput {
  private mic = new MicCapture()
  private asr: AsrStreamClient
  private _active = false

  onTranscript: ((seg: {
    text: string
    is_final: boolean
    metadata?: { emotion?: string; intent?: string; gender?: string; age?: string }
    metadata_probs?: {
      emotion?: Array<{ token: string; probability: number }>
      intent?: Array<{ token: string; probability: number }>
    }
    speech_rate?: { words_per_minute: number; filler_count: number; filler_rate: number; pause_count: number }
  }) => void) | null = null
  onError: ((err: Error) => void) | null = null
  onStateChange: ((active: boolean) => void) | null = null

  constructor(opts?: { url?: string; language?: string; token?: string }) {
    this.asr = new AsrStreamClient(opts)
  }

  get active(): boolean {
    return this._active
  }

  async start(): Promise<void> {
    if (this._active) return

    this.asr.onTranscript = (seg) => this.onTranscript?.(seg)
    this.asr.onError = (err) => {
      this.onError?.(err)
      this.stop()
    }

    await this.asr.connect()

    this.mic.onData = (pcm) => this.asr.sendPcm(pcm)
    this.mic.onError = (err) => {
      this.onError?.(err)
      this.stop()
    }

    await this.mic.start()
    this._active = true
    this.onStateChange?.(true)
  }

  async stop(): Promise<void> {
    if (!this._active) return
    this._active = false
    this.mic.stop()
    try {
      await this.asr.end()
    } catch {}
    this.onStateChange?.(false)
  }

  async toggle(): Promise<void> {
    if (this._active) {
      await this.stop()
    } else {
      await this.start()
    }
  }
}
