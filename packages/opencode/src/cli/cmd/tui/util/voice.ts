import { tmpdir } from "os"
import path from "path"
import { Config } from "@/config/config"
import { Whisper } from "@/voice/whisper"

export type VoiceConfig = {
  command?: string[]
  mime?: string
}

const defaultCommands = [
  ["ffmpeg", "-y", "-f", "pulse", "-i", "default", "-ac", "1", "-ar", "16000", "-f", "mp3", "{output}"],
  ["ffmpeg", "-y", "-f", "alsa", "-i", "default", "-ac", "1", "-ar", "16000", "-f", "mp3", "{output}"],
  ["sox", "-d", "-c", "1", "-r", "16000", "{output}"],
  ["rec", "-c", "1", "-r", "16000", "{output}"],
  ["arecord", "-f", "S16_LE", "-c", "1", "-r", "16000", "{output}"],
]

const defaultMime = "audio/mpeg"

const pickCommand = (config?: VoiceConfig) => {
  if (config?.command?.length) return config.command
  for (const candidate of defaultCommands) {
    const bin = candidate[0]
    if (!bin) continue
    if (Bun.which(bin)) return candidate
  }
  return undefined
}

const readStream = async (stream?: ReadableStream<Uint8Array> | number | null) => {
  if (!stream || typeof stream === "number") return ""
  return new Response(stream).text().catch(() => "")
}

export namespace Voice {
  export function create(input: {
    config: () => VoiceConfig | undefined
    transcription?: () => Config.Info["voice"] | undefined
    sessionID?: () => string | undefined
    prompt?: () => string | undefined
  }) {
    const state = {
      proc: undefined as ReturnType<typeof Bun.spawn> | undefined,
      output: undefined as string | undefined,
      controller: undefined as AbortController | undefined,
      cancelled: false,
    }

    const isEnabled = () => {
      if (!input.transcription?.()?.whisper?.apiKey) return false
      return true
    }

    const start = async () => {
      if (state.proc) return false
      const config = input.config()
      const command = pickCommand(config)
      if (!command) return false
      state.output = path.join(tmpdir(), `opencode-voice-${crypto.randomUUID()}.mp3`)
      const args = command.map((entry) => entry.replaceAll("{output}", state.output!))
      state.proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
      console.log("voice recorder started", { args, output: state.output })
      await Bun.sleep(100)
      return true
    }

    const stop = async () => {
      if (!state.proc || !state.output) return
      const target = state.proc
      state.proc = undefined
      const pathResult = state.output
      state.output = undefined
      target.kill()
      await target.exited.catch(() => {})

      const stdout = await readStream(target.stdout)
      const stderr = await readStream(target.stderr)
      if (stdout || stderr) {
        console.log("voice recorder output", { stdout, stderr })
      }

      const mime = input.config()?.mime ?? defaultMime
      const buffer = await Bun.file(pathResult).arrayBuffer().catch(() => undefined)
      console.log("voice recorder bytes", { bytes: buffer?.byteLength ?? 0 })
      await Bun.file(pathResult).delete().catch(() => {})
      if (!buffer) return

      const blob = new Blob([buffer], { type: mime })
      const apiFile = new File([blob], "audio.mp3", { type: mime })
      console.log("whisper transcribe start", {
        bytes: buffer.byteLength,
        url: input.transcription?.()?.whisper?.url,
        model: input.transcription?.()?.whisper?.model,
        language: input.transcription?.()?.whisper?.language,
      })
      state.cancelled = false
      state.controller = new AbortController()
      const result = await Whisper.transcribe({
        file: apiFile,
        mime,
        sessionID: input.sessionID?.(),
        prompt: input.prompt?.(),
        signal: state.controller.signal,
        voice: input.transcription?.(),
      })
        .then((response) => ({ text: response.text, cancelled: false }))
        .catch((error) => {
          console.log("whisper transcribe failed", { error: String(error) })
          if (error?.name === "AbortError" || state.cancelled) return { text: "", cancelled: true }
          throw error
        })
      state.controller = undefined
      if (!result) return
      return result
    }

    const cancel = () => {
      if (!state.controller) return false
      state.cancelled = true
      state.controller.abort()
      return true
    }

    return {
      isEnabled,
      start,
      stop,
      cancel,
    }
  }
}
