import { pipeline, type PipelineType } from "@xenova/transformers"
import { Log } from "@/util/log"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { WaveFile } from "wavefile"
import { exec } from "child_process"
import { promisify } from "util"
import { openSync, closeSync } from "fs"
import { dlopen, FFIType, suffix } from "bun:ffi"

const execAsync = promisify(exec)

// Suppress ONNX runtime warnings globally
process.env.ORT_LOGGING_LEVEL = "4"
process.env.ONNX_LOGGING_LEVEL = "4"

// HACK: Suppress ONNX Runtime warnings that bypass JavaScript stderr
//
// ONNX Runtime emits warnings directly to file descriptor 2 (stderr) from C++ code
// during model loading, specifically "CleanUnusedInitializersAndNodeArgs" warnings.
// These warnings:
// - Don't respect ORT_LOGGING_LEVEL environment variable
// - Can't be suppressed via process.stderr.write override
// - Are not actionable for end users (they're about internal graph optimization)
// - Clutter the terminal output when enabling voice mode
//
// See: https://github.com/microsoft/onnxruntime/issues/19141
//
// This workaround uses FFI to call dup2() syscall to temporarily redirect stderr
// to /dev/null at the OS level during model initialization, then restores it.
// This is the only reliable way to suppress these warnings without patching ONNX Runtime.
//
// TODO: Remove this hack if/when ONNX Runtime properly respects logging levels

const libc = dlopen("/lib/x86_64-linux-gnu/libc.so.6", {
  dup: {
    args: [FFIType.i32],
    returns: FFIType.i32,
  },
  dup2: {
    args: [FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
})

function redirectStderr() {
  try {
    const devNull = openSync("/dev/null", "w")
    const stderrBackup = libc.symbols.dup(2)

    libc.symbols.dup2(devNull, 2)
    closeSync(devNull)

    return () => {
      libc.symbols.dup2(stderrBackup, 2)
      try {
        closeSync(stderrBackup)
      } catch {}
    }
  } catch (error) {
    return () => {}
  }
}

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

    const modelId = `Xenova/whisper-${this.modelSize}.en`
    const cacheDir = path.join(Global.Path.cache, "voice-models")

    try {
      this.status = "loading"

      // Redirect stderr to suppress ONNX warnings during model loading
      const restoreStderr = redirectStderr()

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
        restoreStderr()
      }

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
