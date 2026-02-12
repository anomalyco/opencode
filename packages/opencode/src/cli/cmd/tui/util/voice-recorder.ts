import { spawn, type ChildProcess } from "child_process"
import { tmpdir } from "os"
import { join } from "path"
import { unlinkSync } from "fs"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

export type VoiceRecorderStatus = "idle" | "recording" | "transcribing" | "error"

export class VoiceRecorder {
  private process: ChildProcess | null = null
  private tempFile: string | null = null
  private client: OpencodeClient
  status: VoiceRecorderStatus = "idle"

  constructor(client: OpencodeClient) {
    this.client = client
  }

  async startRecording(): Promise<void> {
    if (this.status !== "idle") {
      throw new Error("Already recording or transcribing")
    }

    this.tempFile = join(tmpdir(), `voice-input-${Date.now()}.wav`)
    this.status = "recording"

    // Start sox recording process - will continue until stopped
    this.process = spawn("sox", [
      "-d", // default input device
      "-r",
      "16000", // sample rate
      "-c",
      "1", // mono
      "-b",
      "16", // 16-bit
      this.tempFile,
    ])

    this.process.on("error", (err) => {
      this.status = "error"
      console.error("Recording error:", err)
    })
  }

  async stopRecordingAndTranscribe(): Promise<string> {
    if (this.status !== "recording" || !this.process || !this.tempFile) {
      throw new Error("Not currently recording")
    }

    const tempFile = this.tempFile

    // Stop recording by killing sox
    this.process.kill("SIGTERM")
    this.process = null

    // Wait a moment for file to be flushed
    await new Promise((resolve) => setTimeout(resolve, 100))

    this.status = "transcribing"

    try {
      // Read audio file
      const audioFile = Bun.file(tempFile)
      const audioBuffer = await audioFile.arrayBuffer()

      if (audioBuffer.byteLength === 0) {
        throw new Error("Audio file is empty - no audio was recorded")
      }

      const audioBase64 = Buffer.from(audioBuffer).toString("base64")

      // Transcribe using SDK client
      const result = await this.client.voice.transcribe({
        audio: audioBase64,
        timestamps: false,
      })

      if (!result.data) {
        throw new Error("Transcription failed: No data returned")
      }

      const text = result.data.text?.trim() ?? ""

      // Clean up temp file
      try {
        unlinkSync(tempFile)
      } catch {
        // Ignore cleanup errors
      }

      this.status = "idle"
      this.tempFile = null
      return text
    } catch (err) {
      this.status = "error"
      // Don't delete file on error for debugging
      throw err
    }
  }

  cancel(): void {
    if (this.process) {
      this.process.kill("SIGTERM")
      this.process = null
    }
    if (this.tempFile) {
      try {
        unlinkSync(this.tempFile)
      } catch {
        // Ignore
      }
      this.tempFile = null
    }
    this.status = "idle"
  }
}
