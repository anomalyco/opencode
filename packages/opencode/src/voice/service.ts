import { WhisperEngine, type WhisperModelSize } from "./whisper-engine"
import { GlobalBus } from "@/bus/global"
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

  private async saveToDisk() {
    await Config.updateGlobal({
      voice: {
        enabled: this.enabled,
        model: this.currentModel,
        device: "auto",
      },
    })
    this.log.debug("voice settings saved to config", { enabled: this.enabled, model: this.currentModel })
  }

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

    GlobalBus.emit("event", {
      directory: "",
      payload: {
        type: Voice.Event.Updated.type,
        properties: { status },
      },
    })
  }

  async initialize(): Promise<void> {
    const cfg = await Config.getGlobal()

    this.enabled = cfg.voice?.enabled ?? false
    this.currentModel = cfg.voice?.model ?? "base"

    this.log.debug("voice service initialized", { enabled: this.enabled, model: this.currentModel })

    this.publishStatus()

    if (!this.enabled) {
      return
    }

    await this.enable(this.currentModel)
  }

  async enable(model?: WhisperModelSize): Promise<boolean> {
    if (model) {
      this.currentModel = model
    }

    this.enabled = true
    await this.saveToDisk()
    this.publishStatus()

    if (this.engine) {
      return this.engine.isReady()
    }

    this.log.debug("enabling voice engine", { model: this.currentModel })
    this.engine = new WhisperEngine(this.currentModel, "auto")
    this.publishStatus()

    const started = await this.engine.start()
    this.publishStatus()

    if (!started) {
      this.log.warn("voice engine failed to start")
      return false
    }

    this.log.debug("voice service enabled successfully")
    return true
  }

  async disable(): Promise<void> {
    this.enabled = false
    await this.saveToDisk()
    if (this.engine) {
      await this.engine.stop()
      this.engine = null
    }
    this.publishStatus()
    this.log.debug("voice service disabled")
  }

  async switchModel(model: WhisperModelSize): Promise<boolean> {
    if (model === this.currentModel && this.engine?.isReady()) {
      return true
    }

    this.log.debug("switching voice model", { from: this.currentModel, to: model })
    this.currentModel = model
    await this.saveToDisk()

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
    const cacheDir = path.join(Global.Path.cache, "models")
    const downloaded: WhisperModelSize[] = []

    const models: WhisperModelSize[] = ["tiny", "base", "small"]
    for (const model of models) {
      const modelPath = path.join(cacheDir, `whisper-${model}.en`)
      const exists = await Bun.file(path.join(modelPath, "config.json")).exists()
      if (exists) {
        downloaded.push(model)
      }
    }

    return downloaded
  }
}

export const VoiceService = new VoiceServiceImpl()
