import { ParakeetEngine } from "./parakeet-engine"
import { Bus } from "@/bus"
import { Voice } from "./event"
import { Log } from "@/util/log"

export type TranscriptionConfig = {
  enabled: boolean
  model: string
  device: "cuda" | "cpu" | "auto"
  maxDuration: number
  chunkDuration: number
}

export { Voice }

class VoiceServiceImpl {
  private engine: ParakeetEngine | null = null
  private config: TranscriptionConfig = {
    enabled: true,
    model: "nvidia/parakeet-tdt-0.6b-v3",
    device: "auto",
    maxDuration: 300,
    chunkDuration: 3,
  }
  private log = Log.create({ service: "voice" })

  async initialize(config?: Partial<TranscriptionConfig>): Promise<boolean> {
    this.config = { ...this.config, ...config }

    if (!this.config.enabled) {
      this.log.info("voice service disabled by config")
      Bus.publish(Voice.Event.Updated, { available: false })
      return false
    }

    try {
      this.engine = new ParakeetEngine(this.config.model, this.config.device)
      const started = await this.engine.start()

      if (!started) {
        this.config.enabled = false
        this.log.warn("voice engine failed to start")
        Bus.publish(Voice.Event.Updated, { available: false })
        return false
      }

      this.log.info("voice service initialized successfully")
      Bus.publish(Voice.Event.Updated, { available: true })
      return true
    } catch (error) {
      this.config.enabled = false
      this.log.error("voice service initialization error", {
        error: error instanceof Error ? error.message : String(error),
      })
      Bus.publish(Voice.Event.Updated, { available: false })
      return false
    }
  }

  async transcribe(audioBuffer: Buffer, timestamps = false) {
    if (!this.engine || !this.config.enabled) {
      throw new Error("Transcription service not available")
    }

    if (!this.engine.isReady()) {
      throw new Error("Transcription engine not ready")
    }

    return this.engine.transcribe(audioBuffer, timestamps)
  }

  async shutdown() {
    if (this.engine) {
      await this.engine.stop()
      this.engine = null
    }
    Bus.publish(Voice.Event.Updated, { available: false })
  }

  isAvailable(): boolean {
    return this.config.enabled && this.engine !== null && this.engine.isReady()
  }

  getConfig(): TranscriptionConfig {
    return { ...this.config }
  }
}

export const VoiceService = new VoiceServiceImpl()
