import { type Plugin, tool } from "@opencode-ai/plugin"
import { spawn, type Subprocess } from "bun"
import { join } from "path"

export const LiveKitVoicePlugin: Plugin = async (ctx) => {
  let process: Subprocess | null = null
  let isConnected = false

  const startLiveKitSession = async () => {
    if (process) {
      return "LiveKit session already running"
    }

    try {
      const workerPath = join(__dirname, "livekit-worker.ts")
      
      process = spawn({
        cmd: ["bun", "run", workerPath, "dev"],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })

      isConnected = true
      
      // Handle stdout
      if (process.stdout) {
        const reader = process.stdout.getReader()
        readStream(reader)
      }

      // Handle stderr
      if (process.stderr) {
        const reader = process.stderr.getReader()
        readErrorStream(reader)
      }

      return "🎙️ LiveKit voice session started - Connecting to room 'dev'"
    } catch (error) {
      process = null
      isConnected = false
      throw error
    }
  }

  async function readStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = new TextDecoder().decode(value)
      console.log(`🎙️ LiveKit: ${text}`)
    }
  }

  async function readErrorStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = new TextDecoder().decode(value)
      console.error(`⚠️ LiveKit Error: ${text}`)
    }
  }

  const stopLiveKitSession = async () => {
    if (!process) {
      return "No active LiveKit session"
    }

    process.kill()
    process = null
    isConnected = false
    return "🔇 LiveKit voice session stopped"
  }

  return {
    tool: {
      start_livekit_voice: tool({
        description: "Start a LiveKit voice session with voice and audio support in room 'dev'",
        args: {},
        async execute() {
          try {
            const result = await startLiveKitSession()
            return result
          } catch (error) {
            return `Failed to start LiveKit session: ${error instanceof Error ? error.message : String(error)}`
          }
        },
      }),

      stop_livekit_voice: tool({
        description: "Stop the active LiveKit voice session",
        args: {},
        async execute() {
          try {
            const result = await stopLiveKitSession()
            return result
          } catch (error) {
            return `Failed to stop LiveKit session: ${error instanceof Error ? error.message : String(error)}`
          }
        },
      }),

      livekit_status: tool({
        description: "Check the status of the LiveKit voice session",
        args: {},
        async execute() {
          if (!process) {
            return "❌ No active LiveKit session"
          }
          return isConnected 
            ? "✅ LiveKit session active - Connected to room 'dev'" 
            : "⏳ LiveKit session starting..."
        },
      }),
    },

    event: async (input) => {
      if (input.event.type === "session.created") {
        console.log("🎙️ LiveKit Voice Plugin loaded - Auto-starting connection to 'dev' room...")
        await startLiveKitSession()
      }
    },
  }
}
