import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { Prompt } from "@/context/prompt"
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

export const VOICE_AUDIO_MIME = "audio/wav"
export const VOICE_HOLD_DELAY_MS = 250

const DEFAULT_FILENAME = "opencode-voice.wav"

type VoiceConfig = {
  enabled?: boolean
  whisper_url?: string
}

type RecorderWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

export type WavVoiceRecorder = {
  stop: () => Promise<Blob>
}

type VoiceInputControllerOptions = {
  config: Accessor<VoiceConfig | undefined>
  disabled?: Accessor<boolean>
  holdDisabled?: Accessor<boolean>
  holdDelay?: number
  isComposing?: (event: KeyboardEvent) => boolean
  startRecorder?: () => Promise<WavVoiceRecorder>
  transcribe: (audio: Blob) => Promise<string>
  onTranscript: (text: string) => void
  onError: (error: unknown) => void
}

type VoiceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function voiceInputEnabled(config?: VoiceConfig) {
  return config?.enabled === true && !!config.whisper_url?.trim()
}

export function createVoiceFetch(platformFetch?: VoiceFetch, win: Pick<Window, "fetch"> = window): VoiceFetch {
  if (platformFetch) return (input, init) => platformFetch(input, init)
  return (input, init) => win.fetch(input, init)
}

export function createVoiceInputController(options: VoiceInputControllerOptions) {
  const [recording, setRecording] = createSignal(false)
  const [transcribing, setTranscribing] = createSignal(false)
  const available = createMemo(() => voiceInputEnabled(options.config()))
  const disabled = createMemo(() => (options.disabled?.() ?? false) || transcribing())
  const holdDelay = options.holdDelay ?? VOICE_HOLD_DELAY_MS
  let recorder: WavVoiceRecorder | undefined
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let holdRequested = false
  let holdRecording = false
  let holdReleased = false

  const clearHold = () => {
    if (!holdTimer) return
    clearTimeout(holdTimer)
    holdTimer = undefined
  }

  const resetHold = () => {
    clearHold()
    holdRequested = false
    holdRecording = false
    holdReleased = false
  }

  const start = async () => {
    if (!available() || disabled() || recording()) return false

    try {
      recorder = await (options.startRecorder ?? createWavVoiceRecorder)()
      setRecording(true)
      return true
    } catch (error) {
      options.onError(error)
      return false
    }
  }

  const stop = async () => {
    const current = recorder
    if (!current) return

    recorder = undefined
    setRecording(false)
    setTranscribing(true)
    try {
      const text = await options.transcribe(await current.stop())
      options.onTranscript(text)
    } catch (error) {
      options.onError(error)
    } finally {
      setTranscribing(false)
    }
  }

  const canHold = (event: KeyboardEvent) => {
    if (event.code !== "Space") return false
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    if (options.isComposing?.(event)) return false
    if (!available() || disabled() || recording() || options.holdDisabled?.()) return false
    return true
  }

  const handleHoldKeyDown = (event: KeyboardEvent) => {
    if (!canHold(event)) return false

    event.preventDefault()
    if (event.repeat || holdTimer || holdRequested) return true

    holdReleased = false
    holdTimer = setTimeout(() => {
      holdTimer = undefined
      holdRequested = true
      void start().then((started) => {
        if (!holdRequested) return
        holdRecording = started
        if (started && holdReleased) {
          void stop().finally(resetHold)
        }
        if (!started) resetHold()
      })
    }, holdDelay)
    return true
  }

  const handleHoldKeyUp = (event: KeyboardEvent, onShortPress: () => void) => {
    if (event.code !== "Space") return false

    if (holdTimer) {
      event.preventDefault()
      resetHold()
      onShortPress()
      return true
    }

    if (!holdRequested) return false

    event.preventDefault()
    holdReleased = true
    if (holdRecording) {
      void stop().finally(resetHold)
    }
    return true
  }

  onCleanup(() => {
    resetHold()
    const current = recorder
    recorder = undefined
    if (current) void current.stop().catch(() => {})
  })

  return {
    available,
    disabled,
    recording,
    transcribing,
    start,
    stop,
    toggle: async () => {
      if (recording()) return stop()
      await start()
    },
    handleHoldKeyDown,
    handleHoldKeyUp,
  }
}

export function appendVoiceTranscript(prompt: Prompt, transcript: string) {
  const text = transcript.trim()
  if (!text) return { prompt, cursor: promptTextLength(prompt) }

  const images = prompt.filter((part) => part.type === "image")
  const content = prompt.filter((part) => part.type !== "image")
  const length = promptTextLength(content)
  const last = [...content].reverse().find((part) => "content" in part)
  const separator = last && "content" in last && /\S$/.test(last.content) ? " " : ""
  const value = `${separator}${text}`
  const next = [
    ...content,
    {
      type: "text" as const,
      content: value,
      start: length,
      end: length + value.length,
    },
    ...images,
  ]

  return { prompt: next, cursor: length + value.length }
}

export async function createWavVoiceRecorder(win: RecorderWindow = window): Promise<WavVoiceRecorder> {
  const getUserMedia = win.navigator.mediaDevices?.getUserMedia
  if (!getUserMedia) {
    throw new Error("Voice input requires microphone access from a secure HTTPS or localhost page")
  }

  const stream = await getUserMedia.call(win.navigator.mediaDevices, { audio: true })
  const AudioContextCtor = win.AudioContext ?? win.webkitAudioContext
  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error("Audio recording is not supported in this browser")
  }

  const context = new AudioContextCtor()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let stopped = false

  processor.onaudioprocess = (event) => {
    if (stopped) return
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }

  source.connect(processor)
  processor.connect(context.destination)

  return {
    async stop() {
      if (stopped) return encodeWav(chunks, context.sampleRate)
      stopped = true
      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      await context.close()
      return encodeWav(chunks, context.sampleRate)
    },
  }
}

export function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  let offset = 0

  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i))
  }

  writeString("RIFF")
  view.setUint32(offset, 36 + length * 2, true)
  offset += 4
  writeString("WAVE")
  writeString("fmt ")
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint32(offset, sampleRate, true)
  offset += 4
  view.setUint32(offset, sampleRate * 2, true)
  offset += 4
  view.setUint16(offset, 2, true)
  offset += 2
  view.setUint16(offset, 16, true)
  offset += 2
  writeString("data")
  view.setUint32(offset, length * 2, true)
  offset += 4

  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk[i] ?? 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: VOICE_AUDIO_MIME })
}

export async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const size = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size))
  }
  return btoa(binary)
}

export async function transcribeVoice(input: {
  fetch: VoiceFetch
  serverUrl: string
  directory: string
  audio: Blob
  auth?: ServerConnection.HttpBase
}) {
  const url = new URL("/experimental/voice/transcribe", input.serverUrl)
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-opencode-directory": input.directory,
  }

  if (input.auth?.password) {
    headers.authorization = `Basic ${authTokenFromCredentials({
      username: input.auth.username,
      password: input.auth.password,
    })}`
  }

  const response = await input.fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      audio: await blobToBase64(input.audio),
      filename: DEFAULT_FILENAME,
      mime: input.audio.type || VOICE_AUDIO_MIME,
    }),
  })
  if (!response.ok) throw new Error((await response.text()) || `Voice transcription failed: ${response.status}`)

  const body = (await response.json()) as { text?: unknown }
  if (typeof body.text !== "string") throw new Error("Voice transcription response did not include text")
  return body.text
}

function promptTextLength(prompt: Prompt) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}
