import { WhisperEngine, type WhisperModelSize } from "./whisper-engine"
import { Bus } from "@/bus"
import { Voice } from "./event"
import { Log } from "@/util/log"
import { Global } from "@/global"
import path from "path"
import { Config } from "@/config/config"

export { Voice }

class VoiceServiceImpl {
  private engine: WhisperEngine | null = null
  private log = Log.create({ service: "voice" })
  private currentModel: WhisperModelSize = "base"
  private enabled = false

  private publishStatus() {
    const status = (() => {
      if (!this.enabled) return { status: "disabled" as const }
      if (!this.engine) return { status: "idle" as const }

      const engineStatus = this.engine.getStatus()
      if (engineStatus === "idle") return { status: "idle" as const }
      if (engineStatus === "downloading") {
        return { status: "downloading" as const, progress: this.engine.getDownloadProgress() }
      }
      if (engineStatus === "loading") return { status: "loading" as const }
      if (engineStatus === "ready") return { status: "ready" as const, model: this.currentModel }
      return { status: "error" as const, error: "Engine failed to initialize" }
    })()

    Bus.publish(Voice.Event.Updated, { status })
  }

  async initialize(): Promise<void> {
    const cfg = await Config.get()
    const file = Bun.file(path.join(Global.Path.state, "voice.json"))
    const local = await file.json().catch(() => ({}))

    this.log.info("voice initialization", { local, config: cfg.voice })

    this.enabled = local.enabled ?? cfg.voice?.enabled ?? false
    this.currentModel = local.model ?? cfg.voice?.model ?? "base"

    this.log.info("voice enabled state", { enabled: this.enabled, model: this.currentModel })

    this.publishStatus()

    if (!this.enabled) {
      this.log.info("voice service disabled")
      return
    }

    this.log.info("voice service initialized", { model: this.currentModel, enabled: this.enabled })

    await this.enable(this.currentModel)
  }

  async enable(model?: WhisperModelSize): Promise<boolean> {
    if (model) {
      this.currentModel = model
    }

    this.enabled = true
    this.publishStatus()

    if (this.engine) {
      return this.engine.isReady()
    }

    this.log.info("enabling voice engine", { model: this.currentModel })
    this.engine = new WhisperEngine(this.currentModel, "auto")
    this.publishStatus()

    const started = await this.engine.start()
    this.publishStatus()

    if (!started) {
      this.log.warn("voice engine failed to start")
      return false
    }

    this.log.info("voice service enabled successfully")
    return true
  }

  async disable(): Promise<void> {
    this.enabled = false
    if (this.engine) {
      await this.engine.stop()
      this.engine = null
    }
    this.publishStatus()
    this.log.info("voice service disabled")
  }

  async switchModel(model: WhisperModelSize): Promise<boolean> {
    if (model === this.currentModel && this.engine?.isReady()) {
      return true
    }

    this.log.info("switching voice model", { from: this.currentModel, to: model })
    this.currentModel = model

    if (this.engine) {
      await this.engine.stop()
      this.engine = null
    }

    if (!this.enabled) {
      return true
    }

    return this.enable(model)
  }

  async transcribe(audioBuffer: Buffer, timestamps = false) {
    if (!this.enabled) {
      throw new Error("Voice transcription is disabled")
    }

    if (!this.engine) {
      const started = await this.enable()
      if (!started || !this.engine) {
        throw new Error("Failed to start voice engine")
      }
    }

    if (!this.engine.isReady()) {
      throw new Error("Voice engine not ready")
    }

    return this.engine.transcribe(audioBuffer, timestamps)
  }

  async shutdown() {
    await this.disable()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  isReady(): boolean {
    return this.enabled && this.engine !== null && this.engine.isReady()
  }

  getStatus(): Voice.Status {
    if (!this.enabled) return { status: "disabled" }
    if (!this.engine) return { status: "idle" }

    const engineStatus = this.engine.getStatus()
    if (engineStatus === "idle") return { status: "idle" }
    if (engineStatus === "downloading") {
      return { status: "downloading", progress: this.engine.getDownloadProgress() }
    }
    if (engineStatus === "loading") return { status: "loading" }
    if (engineStatus === "ready") return { status: "ready", model: this.currentModel }
    return { status: "error", error: "Engine failed to initialize" }
  }

  getCurrentModel(): WhisperModelSize {
    return this.currentModel
  }

  async getAvailableModels(): Promise<Array<{ name: WhisperModelSize; size: string }>> {
    return [
      { name: "tiny", size: "75 MB" },
      { name: "base", size: "142 MB" },
      { name: "small", size: "466 MB" },
    ]
  }

  async getDownloadedModels(): Promise<WhisperModelSize[]> {
    const cacheDir = path.join(Global.Path.cache, "voice-models")
    const downloaded: WhisperModelSize[] = []

    const models: WhisperModelSize[] = ["tiny", "base", "small"]
    for (const model of models) {
      const modelPath = path.join(cacheDir, `Xenova_whisper-${model}.en`)
      const exists = await Bun.file(path.join(modelPath, "config.json")).exists()
      if (exists) {
        downloaded.push(model)
      }
    }

    return downloaded
  }
}

export const VoiceService = new VoiceServiceImpl()
