import { spawn, type ChildProcess } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { Bus } from "@/bus"
import { Voice } from "./event"
import { Log } from "@/util/log"

const getCurrentDir = () => {
  if (typeof __dirname !== "undefined") return __dirname
  if (typeof import.meta.url !== "undefined") return dirname(fileURLToPath(import.meta.url))
  return process.cwd()
}

export type VoiceResult = {
  text: string
  timestamps?: {
    word: Array<{ start: number; end: number; word: string }>
    segment: Array<{ start: number; end: number; segment: string }>
  }
}

export type VoiceStatus = "loading" | "ready" | "error" | "stopped"

export class ParakeetEngine {
  private process: ChildProcess | null = null
  private status: VoiceStatus = "stopped"
  private model: string
  private device: "cuda" | "cpu" | "auto"
  private readyPromise: Promise<void> | null = null
  private responseHandlers = new Map<number, (result: VoiceResult | { error: string }) => void>()
  private requestId = 0
  private log = Log.create({ service: "voice.parakeet" })

  constructor(model = "nvidia/parakeet-tdt-0.6b-v3", device: "cuda" | "cpu" | "auto" = "auto") {
    this.model = model
    this.device = device
  }

  async start(): Promise<boolean> {
    if (this.process) {
      return this.status === "ready"
    }

    this.readyPromise = new Promise((resolve, reject) => {
      const currentDir = getCurrentDir()
      const pythonScript = join(currentDir, "../../python/voice/voice_server.py")
      const pythonBinary = join(currentDir, "../../python/voice/venv/bin/python")

      const args = [pythonScript, "--model", this.model]

      if (this.device !== "auto") {
        args.push("--device", this.device)
      }

      this.process = spawn(pythonBinary, args, {
        stdio: ["pipe", "pipe", "pipe"],
      })

      const state = { resolved: false }

      const timeout = setTimeout(() => {
        if (!state.resolved) {
          reject(new Error("Initialization timeout"))
        }
      }, 300000)

      this.process.stdout?.on("data", (data) => {
        const lines = data.toString().split("\n")
        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const msg = JSON.parse(line)

            if (msg.status === "loading") {
              const previousStatus = this.status
              this.status = "loading"
              if (previousStatus !== "loading") {
                Bus.publish(Voice.Event.Updated, { available: false })
              }
              continue
            }
            if (msg.status === "ready") {
              const previousStatus = this.status
              this.status = "ready"
              if (!state.resolved) {
                state.resolved = true
                clearTimeout(timeout)
                resolve()
              }
              if (previousStatus !== "ready") {
                this.log.info("parakeet engine ready", {
                  model: this.model,
                  device: this.device,
                })
                Bus.publish(Voice.Event.Updated, { available: true })
              }
              continue
            }
            if (msg.status === "error") {
              const previousStatus = this.status
              this.status = "error"
              if (!state.resolved) {
                state.resolved = true
                clearTimeout(timeout)
                reject(new Error(msg.message))
              }
              if (previousStatus !== "error") {
                Bus.publish(Voice.Event.Updated, { available: false })
              }
              continue
            }
            if (msg.text !== undefined || msg.error) {
              const handler = this.responseHandlers.get(this.requestId - 1)
              if (handler) {
                handler(msg)
                this.responseHandlers.delete(this.requestId - 1)
              }
            }
          } catch (e) {
            // Silently skip non-JSON lines
          }
        }
      })

      this.process.stderr?.on("data", (data) => {
        // Suppress stderr - Python NeMo warnings are verbose
      })

      this.process.on("exit", (code) => {
        this.status = "stopped"
        this.process = null
        Bus.publish(Voice.Event.Updated, { available: false })
        if (!state.resolved) {
          clearTimeout(timeout)
          reject(new Error(`Process exited with code ${code}`))
        }
      })

      this.process.on("error", (err) => {
        this.status = "error"
        Bus.publish(Voice.Event.Updated, { available: false })
        if (!state.resolved) {
          clearTimeout(timeout)
          reject(err)
        }
      })
    })

    try {
      await this.readyPromise
      return true
    } catch (error) {
      return false
    }
  }

  async transcribe(audioBuffer: Buffer, timestamps = false): Promise<VoiceResult> {
    if (!this.process || this.status !== "ready") {
      throw new Error("Voice engine not ready")
    }

    return new Promise((resolve, reject) => {
      const id = this.requestId++
      const audioBase64 = audioBuffer.toString("base64")

      this.responseHandlers.set(id, (result) => {
        if ("error" in result) {
          reject(new Error(result.error))
          return
        }
        resolve(result)
      })

      const request = {
        command: "transcribe",
        audio: audioBase64,
        timestamps,
      }

      this.process!.stdin?.write(JSON.stringify(request) + "\n")

      setTimeout(() => {
        if (this.responseHandlers.has(id)) {
          this.responseHandlers.delete(id)
          reject(new Error("Voice timeout"))
        }
      }, 30000)
    })
  }

  async stop() {
    if (!this.process) return

    this.process.stdin?.write(JSON.stringify({ command: "shutdown" }) + "\n")

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill("SIGKILL")
        resolve()
      }, 5000)

      this.process?.once("exit", () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    this.process = null
    this.status = "stopped"
    Bus.publish(Voice.Event.Updated, { available: false })
  }

  getStatus(): VoiceStatus {
    return this.status
  }

  isReady(): boolean {
    return this.status === "ready"
  }
}
