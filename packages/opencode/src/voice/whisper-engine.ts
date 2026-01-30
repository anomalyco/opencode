import { pipeline, type PipelineType } from "@xenova/transformers"
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
    this.log.info("initializing whisper engine", { modelSize: this.modelSize, device: this.device })

    const modelId = `Xenova/whisper-${this.modelSize}.en`
    const cacheDir = path.join(Global.Path.cache, "voice-models")

    try {
      this.status = "loading"

      process.env.ORT_LOGGING_LEVEL = "4"

      const originalStderrWrite = process.stderr.write.bind(process.stderr)
      let stderrBuffer = ""

      process.stderr.write = ((chunk: any): boolean => {
        const str = chunk.toString()
        stderrBuffer += str
        return true
      }) as any

      try {
        this.transcriber = await pipeline("automatic-speech-recognition", modelId, {
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
      } finally {
        process.stderr.write = originalStderrWrite
      }

      this.status = "ready"
      this.log.info("whisper engine ready", { modelSize: this.modelSize })
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

      let audioData = wav.getSamples()
      if (Array.isArray(audioData)) {
        if (audioData.length > 1) {
          const SCALING_FACTOR = Math.sqrt(2)
          for (let i = 0; i < audioData[0].length; ++i) {
            audioData[0][i] = (SCALING_FACTOR * (audioData[0][i] + audioData[1][i])) / 2
          }
        }
        audioData = audioData[0]
      }

      const result = await this.transcriber(audioData, {
        return_timestamps: timestamps,
        language: "en",
        task: "transcribe",
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
