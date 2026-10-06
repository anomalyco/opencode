import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { errorMessage } from "./error"

export type VoiceConfig = {
  url?: string
  api_key?: string
  model?: string
  command?: readonly string[]
  mime?: string
}

// Voice ships unconfigured: no default endpoint or model. These are only used
// as a hint in Settings and as a wire-level fallback for OpenAI-compatible
// servers when no model is configured.
export const exampleTranscriptionUrl = "http://127.0.0.1:8797/v1/audio/transcriptions"
export const fallbackTranscriptionModel = "whisper-1"

const SAMPLE_RATE = 16000

// Default recording commands stream raw mono PCM (s16le) to stdout so the TUI
// can render a live waveform and build a complete WAV in memory. Custom
// `voice.command` entries keep the file mode with the `{output}` placeholder.
const platformCommands: Record<string, string[][]> = {
  linux: [
    ["ffmpeg", "-y", "-f", "pulse", "-i", "default", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
    ["ffmpeg", "-y", "-f", "alsa", "-i", "default", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
    ["arecord", "-f", "S16_LE", "-c", "1", "-r", "16000", "-t", "raw", "-"],
  ],
  darwin: [
    ["ffmpeg", "-y", "-f", "avfoundation", "-i", ":0", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
  ],
}

// Windows has no default DirectShow device, so the first audio capture device
// is resolved once and reused (wasapi is not an ffmpeg input).
let windowsDeviceCache: string | undefined | null = null

const windowsAudioDevice = (): string | undefined => {
  if (windowsDeviceCache !== null) return windowsDeviceCache ?? undefined
  windowsDeviceCache = undefined
  try {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      encoding: "utf8",
    })
    const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    for (const raw of output.split(/\r?\n/)) {
      const line = raw.replace(/^\[[^\]]*\]\s*/, "")
      const match = /"([^"]+)"\s*\(audio\)/.exec(line)
      if (match?.[1]) {
        windowsDeviceCache = match[1]
        return match[1]
      }
    }
  } catch {
    // no capture device detected
  }
  return undefined
}

const windowsCommands = (): string[][] => {
  const device = windowsAudioDevice()
  if (!device) return []
  return [
    [
      "ffmpeg",
      "-y",
      "-f",
      "dshow",
      "-audio_buffer_size",
      "50",
      "-i",
      `audio=${device}`,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "-",
    ],
  ]
}

const platformCommand = () =>
  process.platform === "win32" ? windowsCommands() : (platformCommands[process.platform] ?? [])

const crossPlatformCommands = [
  ["sox", "-d", "-c", "1", "-r", "16000", "-e", "signed", "-b", "16", "-L", "-t", "raw", "-"],
  ["rec", "-c", "1", "-r", "16000", "-e", "signed", "-b", "16", "-L", "-t", "raw", "-"],
]

const defaultMime = "audio/wav"

const commandCache = new Map<string, boolean>()

const hasCommand = (bin: string) => {
  const cached = commandCache.get(bin)
  if (cached !== undefined) return cached
  let found = false
  try {
    found = !!Bun.which(bin)
  } catch {
    found = false
  }
  commandCache.set(bin, found)
  return found
}

type CommandMode = "stream" | "file"
type PickedCommand = { command: readonly string[]; mode: CommandMode }

const resolveCommand = (config?: VoiceConfig): PickedCommand | undefined => {
  if (config?.command?.length) {
    const bin = config.command[0]
    if (bin && hasCommand(bin)) return { command: config.command, mode: "file" }
    return undefined
  }
  for (const candidate of [...platformCommand(), ...crossPlatformCommands]) {
    const bin = candidate[0]
    if (bin && hasCommand(bin)) return { command: candidate, mode: "stream" }
  }
  return undefined
}

const noCommandMessage = "No recording command available (install ffmpeg or sox)"

const pickCommand = (config?: VoiceConfig) => {
  const cmd = resolveCommand(config)
  if (!cmd) throw new Error(noCommandMessage)
  return cmd
}

const pcmToWav = (chunks: Buffer[], bytes: number, sampleRate: number) => {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(36 + bytes, 4)
  header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36, "ascii")
  header.writeUInt32LE(bytes, 40)
  return Buffer.concat([header, ...chunks], 44 + bytes)
}

export function create(input: {
  config: () => VoiceConfig | undefined
  prompt?: () => string | undefined
  onLevel?: (level: number) => void
  onError?: (error: Error) => void
  transcribe: (audio: string, mime: string, prompt?: string, signal?: AbortSignal) => Promise<{ text: string }>
}) {
  const state = {
    proc: undefined as ChildProcess | undefined,
    output: undefined as string | undefined,
    chunks: [] as Buffer[],
    bytes: 0,
    mode: "file" as CommandMode,
    controller: undefined as AbortController | undefined,
    cancelled: false,
    lastRecording: undefined as { path: string; mime: string } | undefined,
    lastBuffer: undefined as { buffer: ArrayBuffer; mime: string } | undefined,
  }

  const isEnabled = () => !!resolveCommand(input.config())

  const unavailableMessage = () => {
    if (!resolveCommand(input.config())) return noCommandMessage
    return undefined
  }

  const spawnRecorder = (args: readonly string[]) => {
    const child = spawn(args[0]!, args.slice(1), { stdio: ["pipe", "pipe", "pipe"] })
    // A missing or non-executable binary must not crash the TUI; report it and
    // leave the state clean so the next attempt can start new.
    child.on("error", (error) => {
      if (state.proc === child) state.proc = undefined
      try {
        child.kill()
      } catch {
        // already gone
      }
      input.onError?.(error instanceof Error ? error : new Error(String(error)))
    })
    return child
  }

  const start = async () => {
    if (state.proc) return false
    clearRecording()
    const config = input.config()
    const picked = pickCommand(config)
    state.mode = picked.mode
    if (picked.mode === "stream") {
      state.chunks = []
      state.bytes = 0
      const args = picked.command
      state.proc = spawnRecorder(args)
      state.proc.stdout?.on("data", (data: Buffer) => {
        const chunk = Buffer.from(data)
        state.chunks.push(chunk)
        state.bytes += chunk.length
        let sum = 0
        let samples = 0
        for (let i = 0; i + 1 < chunk.length; i += 2) {
          const value = chunk.readInt16LE(i) / 32768
          sum += value * value
          samples++
        }
        const rms = Math.sqrt(sum / Math.max(1, samples))
        input.onLevel?.(Math.max(0, Math.min(1, rms * 6)))
      })
      return true
    }
    const outputPath = path.join(tmpdir(), `opencode-voice-${crypto.randomUUID()}.wav`)
    state.output = outputPath
    const args = picked.command.map((entry) => entry.replaceAll("{output}", outputPath))
    state.proc = spawnRecorder(args)
    return true
  }

  const transcribeBuffer = (buffer: ArrayBuffer, mime: string) => {
    state.cancelled = false
    state.controller = new AbortController()

    const base64 = Buffer.from(buffer).toString("base64")
    return input
      .transcribe(base64, mime, input.prompt?.(), state.controller.signal)
      .then((response) => {
        state.controller = undefined
        if (state.cancelled) return { text: "", cancelled: true }
        return { text: response.text, cancelled: false }
      })
      .catch((error) => {
        state.controller = undefined
        if ((error instanceof Error && error.name === "AbortError") || state.cancelled) {
          return { text: "", cancelled: true }
        }
        throw error instanceof Error ? error : new Error(errorMessage(error))
      })
  }

  const stop = async () => {
    if (!state.proc) return
    const target = state.proc
    state.proc = undefined
    const pathResult = state.output
    state.output = undefined
    const mode = state.mode

    // Graceful stop: hard-killing the recorder loses buffered audio (the WAV
    // stream is flushed in blocks and only completed on close). Ask ffmpeg to
    // quit and fall back to a hard kill if it does not exit in time. A recorder
    // that already exited (device busy, spawn failure) must not hang the wait.
    const exited = new Promise<void>((resolve) => {
      if (target.exitCode !== null || target.signalCode !== null) return resolve()
      const timer = setTimeout(() => {
        if (!target.killed) target.kill()
        resolve()
      }, 1500)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      target.on("exit", done)
      target.on("close", done)
      try {
        target.stdin?.write("q")
      } catch {
        // fall back to the kill timer
      }
    })
    await exited

    if (mode === "stream") {
      const bytes = state.bytes
      const chunks = state.chunks
      state.chunks = []
      state.bytes = 0
      const wav = pcmToWav(chunks, bytes, SAMPLE_RATE)
      const buffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer
      state.lastBuffer = { buffer, mime: "audio/wav" }
      return transcribeBuffer(buffer, "audio/wav")
    }

    const mime = input.config()?.mime ?? defaultMime
    const buffer = await readFile(pathResult!).catch((err) => {
      throw new Error(`Failed to read voice recording: ${err instanceof Error ? err.message : String(err)}`)
    })

    state.lastRecording = { path: pathResult!, mime }

    return transcribeBuffer(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      mime,
    )
  }

  const retry = async () => {
    if (state.lastBuffer) return transcribeBuffer(state.lastBuffer.buffer, state.lastBuffer.mime)
    if (!state.lastRecording) return
    const { path: recordingPath, mime } = state.lastRecording
    const buffer = await readFile(recordingPath).catch((err) => {
      throw new Error(`Failed to read voice recording: ${err instanceof Error ? err.message : String(err)}`)
    })
    return transcribeBuffer(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      mime,
    )
  }

  const clearRecording = () => {
    state.lastBuffer = undefined
    if (!state.lastRecording) return
    rm(state.lastRecording.path, { force: true }).catch(() => {})
    state.lastRecording = undefined
  }

  const hasRecording = () => !!state.lastBuffer || !!state.lastRecording

  const cancel = () => {
    if (!state.controller) return false
    state.cancelled = true
    state.controller.abort()
    return true
  }

  const destroy = () => {
    if (state.controller) {
      state.cancelled = true
      state.controller.abort()
    }
    if (state.proc) {
      state.proc.kill()
      const file = state.output
      state.proc = undefined
      state.output = undefined
      if (file) rm(file, { force: true }).catch(() => {})
    }
    state.chunks = []
    state.bytes = 0
    clearRecording()
  }

  return {
    isEnabled,
    unavailableMessage,
    start,
    stop,
    retry,
    cancel,
    destroy,
    clearRecording,
    hasRecording,
  }
}

export * as Voice from "./voice"
