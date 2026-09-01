import { spawn, type ChildProcess } from "child_process"
import { EventEmitter } from "events"
import type { AudioRecordingBuffer } from "./types"
import { HardwareAudioDetector, type HardwareAudioStatus } from "./detector"

export class AudioRecorder extends EventEmitter {
  private process: ChildProcess | null = null
  private chunks: Buffer[] = []
  private isRecording = false
  private startTime = 0
  private hardwareStatus: HardwareAudioStatus

  constructor() {
    super()
    this.hardwareStatus = HardwareAudioDetector.detect()
  }

  public get recording(): boolean {
    return this.isRecording
  }

  public get status(): HardwareAudioStatus {
    return this.hardwareStatus
  }

  public start(): boolean {
    if (this.isRecording) return false

    // Refresh hardware detection
    this.hardwareStatus = HardwareAudioDetector.detect()
    if (!this.hardwareStatus.available) {
      this.emit(
        "error",
        new Error(
          `No active microphone found or required audio recording tools missing on ${process.platform}. (Install 'arecord', 'sox', or 'ffmpeg')`
        )
      )
      return false
    }

    this.chunks = []
    this.isRecording = true
    this.startTime = Date.now()

    const platform = process.platform
    const tools = this.hardwareStatus.tools

    // Platform & tool priority:
    // Linux: arecord > sox > ffmpeg
    // macOS: rec (sox) > ffmpeg
    // Windows: ffmpeg (dshow)
    if (platform === "linux") {
      if (tools.includes("arecord")) {
        this.process = spawn("arecord", ["-q", "-r", "16000", "-f", "S16_LE", "-c", "1", "-t", "wav"])
      } else if (tools.includes("sox")) {
        this.process = spawn("sox", ["-d", "-q", "-r", "16000", "-b", "16", "-c", "1", "-t", "wav", "-"])
      } else {
        this.process = spawn("ffmpeg", ["-f", "pulse", "-i", "default", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"])
      }
    } else if (platform === "darwin") {
      if (tools.includes("rec")) {
        this.process = spawn("rec", ["-q", "-r", "16000", "-b", "16", "-c", "1", "-t", "wav", "-"])
      } else {
        this.process = spawn("ffmpeg", ["-f", "avfoundation", "-i", ":0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"])
      }
    } else {
      // Windows
      this.process = spawn("ffmpeg", ["-f", "dshow", "-i", "audio=default", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"])
    }

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.chunks.push(chunk)
      this.emit("data", chunk)
    })

    this.process.on("error", (err) => {
      this.emit("error", err)
      this.stop()
    })

    return true
  }

  public async stop(): Promise<AudioRecordingBuffer | null> {
    if (!this.isRecording) return null

    this.isRecording = false
    const durationMs = Date.now() - this.startTime

    if (this.process) {
      this.process.kill("SIGTERM")
      this.process = null
    }

    const fullBuffer = Buffer.concat(this.chunks)
    this.chunks = []

    return {
      pcmBuffer: fullBuffer,
      sampleRate: 16000,
      channels: 1,
      durationMs,
    }
  }
}
