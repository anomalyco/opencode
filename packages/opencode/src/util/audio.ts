import { Log } from "./log"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import os from "os"

export namespace Audio {
  const log = Log.create({ service: "audio" })

  export interface RecordingSession {
    stop: () => Promise<Blob>
    isRecording: boolean
  }

  export async function startRecording(): Promise<RecordingSession> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-audio-"))
    const audioFile = path.join(tempDir, "recording.wav")
    
    let isRecording = true
    let proc: any

    // Try to use available recording tools based on platform
    const platform = process.platform
    
    log.info("starting audio recording", { platform, audioFile })

    if (platform === "darwin") {
      // macOS - use sox with default audio device, let it run until killed
      proc = Bun.spawn(['sox', '-d', '-t', 'wav', audioFile], {
        stdout: 'ignore',
        stderr: 'ignore',
      })
    } else if (platform === "linux") {
      // Linux - use arecord (ALSA)
      proc = Bun.spawn(['arecord', '-f', 'cd', '-c', '1', '-r', '16000', audioFile], {
        stdout: 'ignore',
        stderr: 'ignore',
      })
    } else {
      throw new Error("Audio recording not supported on this platform")
    }
    
    // Give sox time to start and create file
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    log.info("recording started", { pid: proc.pid })

    return {
      async stop() {
        isRecording = false
        log.info("stopping audio recording", { audioFile, pid: proc.pid })
        
        try {
          proc.kill()
          await proc.exited
          log.info("recording process exited")
        } catch (e) {
          log.error("error killing recording process", { error: e })
        }

        // Wait for file to be fully written and flushed to disk
        await new Promise(resolve => setTimeout(resolve, 2000))

        const file = Bun.file(audioFile)
        
        // Check if file exists and has content
        const exists = await file.exists()
        if (!exists) {
          log.error("audio file does not exist", { audioFile })
          throw new Error("Recording file not found")
        }
        
        const size = await file.size
        log.info("audio file info", { audioFile, size, exists })
        
        if (size === 0) {
          log.error("audio file is empty", { audioFile })
          throw new Error("Recording file is empty")
        }
        
        const arrayBuffer = await file.arrayBuffer()
        const blob = new Blob([arrayBuffer], { type: "audio/wav" })
        
        log.info("created blob", { blobSize: blob.size, blobType: blob.type })
        
        // Cleanup
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        
        return blob
      },
      get isRecording() {
        return isRecording
      }
    }
  }

  export async function checkRecordingAvailable(): Promise<boolean> {
    const platform = process.platform
    
    try {
      if (platform === "darwin") {
        // Check for sox
        const result = await $`which sox`.nothrow().quiet()
        return result.exitCode === 0
      } else if (platform === "linux") {
        // Check for arecord
        const result = await $`which arecord`.nothrow().quiet()
        return result.exitCode === 0
      }
    } catch (error) {
      log.error("error checking recording availability", { error })
    }
    
    return false
  }
}

