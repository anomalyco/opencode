import { pipeline } from "@huggingface/transformers"
import { Log } from "@/util/log"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { WaveFile } from "wavefile"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export type WhisperModelSize = "tiny" | "base" | "small"

export type WhisperEngineStatus = "idle" | "downloading" | "loading" | "ready" | "error"

export class WhisperEngine {
  private transcriber: any = null
  private status: WhisperEngineStatus = "idle"
  private log = Log.create({ service: "voice-whisper" })
  private downloadProgress = 0

  constructor(
    private modelSize: WhisperModelSize = "base",
    private device: "cpu" | "gpu" | "auto" = "auto",
  ) {}

  async start(): Promise<boolean> {
    if (this.status === "ready") return true
    if (this.status === "downloading" || this.status === "loading") return false

    this.status = "downloading"
    this.log.debug("initializing whisper engine", { modelSize: this.modelSize, device: this.device })

    const modelId = `whisper-${this.modelSize}.en`
    const cacheDir = path.join(Global.Path.cache, "models")

    try {
      this.status = "loading"

      this.transcriber = await pipeline("automatic-speech-recognition", modelId, {
        session_options: {
          log_severity_level: 4,
        },
        dtype: "fp32",
        quantized: true,
        device: this.device === "auto" ? undefined : this.device,
        cache_dir: cacheDir,
        progress_callback: (progress: any) => {
          if (progress.status === "downloading") {
            const percent = progress.progress ? Math.round(progress.progress) : 0
            if (percent !== this.downloadProgress) {
              this.downloadProgress = percent
              this.log.debug("model download progress", { percent })
            }
          }
        },
      } as any)

      this.status = "ready"
      this.log.debug("whisper engine ready", { modelSize: this.modelSize })
      return true
    } catch (error) {
      this.status = "error"
      this.log.error("failed to initialize whisper engine", {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  async transcribe(
    audioBuffer: Buffer,
    timestamps = false,
  ): Promise<{ text: string; chunks?: Array<{ text: string; timestamp: [number, number] }> }> {
    if (!this.isReady()) {
      throw new Error("Whisper engine not ready")
    }

    const tempInput = path.join(os.tmpdir(), `opencode-audio-${Date.now()}.webm`)
    const tempWav = path.join(os.tmpdir(), `opencode-audio-${Date.now()}.wav`)

    try {
      await fs.writeFile(tempInput, audioBuffer)

      await execAsync(`ffmpeg -i "${tempInput}" -ar 16000 -ac 1 -f wav "${tempWav}" -y -loglevel quiet`)

      const wavBuffer = await fs.readFile(tempWav)
      const wav = new WaveFile(wavBuffer)

      wav.toBitDepth("32f")
      wav.toSampleRate(16000)

      const rawAudioData = wav.getSamples()
      const audioData = (() => {
        if (!Array.isArray(rawAudioData)) return rawAudioData

        if (rawAudioData.length === 1) return rawAudioData[0]

        // Mix stereo to mono
        const SCALING_FACTOR = Math.sqrt(2)
        for (let i = 0; i < rawAudioData[0].length; ++i) {
          rawAudioData[0][i] = (SCALING_FACTOR * (rawAudioData[0][i] + rawAudioData[1][i])) / 2
        }
        return rawAudioData[0]
      })()

      const result = await this.transcriber(audioData, {
        return_timestamps: timestamps,
        chunk_length_s: 30,
        stride_length_s: 5,
      })

      return {
        text: result.text.trim(),
        ...(timestamps && result.chunks ? { chunks: result.chunks } : {}),
      }
    } finally {
      await fs.unlink(tempInput).catch(() => {})
      await fs.unlink(tempWav).catch(() => {})
    }
  }

  async stop() {
    this.transcriber = null
    this.status = "idle"
    this.log.info("whisper engine stopped")
  }

  isReady(): boolean {
    return this.status === "ready" && this.transcriber !== null
  }

  getStatus(): WhisperEngineStatus {
    return this.status
  }

  getDownloadProgress(): number {
    return this.downloadProgress
  }
}
