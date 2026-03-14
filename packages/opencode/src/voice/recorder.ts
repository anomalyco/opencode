import { randomUUID } from "crypto"
import { unlinkSync, existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { Process } from "@/util/process"

export namespace AudioRecorder {
  export interface Recorder {
    start(): void
    stop(): Promise<Buffer>
    isRecording(): boolean
  }

  function getAudioInputArgs(): string[] {
    const platform = process.platform

    if (platform === "win32") {
      return ["-f", "dshow", "-i", "audio=default", "-hide_banner"]
    }

    if (platform === "darwin") {
      return ["-f", "avfoundation", "-i", ":0", "-hide_banner"]
    }

    return ["-f", "pulse", "-i", "default", "-hide_banner"]
  }

  export function create(): Recorder {
    let recording = false
    let tempFile: string | null = null
    let proc: Process.Child | null = null

    return {
      start() {
        if (recording) return

        recording = true
        tempFile = `${tmpdir()}/voice-${randomUUID()}.wav`

        const args = [
          ...getAudioInputArgs(),
          "-ac", "1",
          "-ar", "16000",
          "-t", "60",
          "-y",
          tempFile,
        ]

        proc = Process.spawn(["ffmpeg", ...args], {
          stdout: "ignore",
          stderr: "pipe",
        })
      },

      async stop(): Promise<Buffer> {
        if (!recording || !proc) {
          return Buffer.alloc(0)
        }

        recording = false

        proc.kill("SIGTERM")

        try {
          await proc.exited
        } catch {
        }

        proc = null

        if (!tempFile || !existsSync(tempFile)) {
          return Buffer.alloc(0)
        }

        const audio = readFileSync(tempFile)
        unlinkSync(tempFile)
        tempFile = null

        return audio
      },

      isRecording() {
        return recording
      },
    }
  }
}
