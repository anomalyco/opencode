import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  appendVoiceTranscript,
  createVoiceFetch,
  createVoiceInputController,
  createWavVoiceRecorder,
  encodeWav,
  transcribeVoice,
  voiceInputEnabled,
} from "./voice-input"
import type { Prompt } from "@/context/prompt"

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}) {
  let preventDefaultCount = 0
  const event = {
    code: "Space",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 32,
    preventDefault: () => {
      preventDefaultCount++
    },
    ...overrides,
  } as KeyboardEvent

  return {
    event,
    preventDefaultCount: () => preventDefaultCount,
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("voice input", () => {
  test("is enabled only by explicit config", () => {
    expect(voiceInputEnabled()).toBe(false)
    expect(voiceInputEnabled({})).toBe(false)
    expect(voiceInputEnabled({ enabled: false })).toBe(false)
    expect(voiceInputEnabled({ enabled: true })).toBe(false)
    expect(voiceInputEnabled({ enabled: true, whisper_url: "   " })).toBe(false)
    expect(voiceInputEnabled({ enabled: true, whisper_url: "http://127.0.0.1:8080" })).toBe(true)
  })

  test("appends transcript as text before image attachments", () => {
    const prompt: Prompt = [
      { type: "text", content: "fix this", start: 0, end: 8 },
      { type: "image", id: "img", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,a" },
    ]

    const result = appendVoiceTranscript(prompt, "please")

    expect(result.cursor).toBe(15)
    expect(result.prompt).toEqual([
      { type: "text", content: "fix this", start: 0, end: 8 },
      { type: "text", content: " please", start: 8, end: 15 },
      { type: "image", id: "img", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,a" },
    ])
  })

  test("encodes mono wav audio", async () => {
    const blob = encodeWav([new Float32Array([-1, 0, 1])], 16_000)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder().decode(bytes.slice(0, 12))

    expect(blob.type).toBe("audio/wav")
    expect(text).toBe("RIFF*\u0000\u0000\u0000WAVE")
    expect(bytes.byteLength).toBe(50)
  })

  test("reports unavailable microphone APIs clearly", async () => {
    await expect(createWavVoiceRecorder({ navigator: {} } as Window & typeof globalThis)).rejects.toThrow(
      "Voice input requires microphone access from a secure HTTPS or localhost page",
    )
  })

  test("binds browser fetch to window", async () => {
    const win = {
      fetch(input: string | URL | Request, init?: RequestInit) {
        expect(this).toBe(win)
        return Promise.resolve(Response.json({ input: String(input), method: init?.method }))
      },
    }

    const response = await createVoiceFetch(undefined, win as Pick<Window, "fetch">)("https://server.example.test", {
      method: "POST",
    })

    await expect(response.json()).resolves.toEqual({ input: "https://server.example.test", method: "POST" })
  })

  test("records and transcribes through the controller", async () => {
    await createRoot(async (dispose) => {
      const audio = new Blob([new Uint8Array([1])], { type: "audio/wav" })
      const transcripts: string[] = []
      const errors: unknown[] = []
      let transcribed: Blob | undefined

      const voice = createVoiceInputController({
        config: () => ({ enabled: true, whisper_url: "http://127.0.0.1:8080" }),
        startRecorder: async () => ({ stop: async () => audio }),
        transcribe: async (blob) => {
          transcribed = blob
          return "hello"
        },
        onTranscript: (text) => transcripts.push(text),
        onError: (error) => errors.push(error),
      })

      expect(voice.available()).toBe(true)
      await voice.toggle()
      expect(voice.recording()).toBe(true)
      await voice.toggle()
      expect(voice.recording()).toBe(false)
      expect(voice.transcribing()).toBe(false)
      expect(transcribed).toBe(audio)
      expect(transcripts).toEqual(["hello"])
      expect(errors).toEqual([])
      dispose()
    })
  })

  test("preserves quick space taps during hold-to-record", async () => {
    await createRoot(async (dispose) => {
      const spaces: string[] = []
      let starts = 0
      const voice = createVoiceInputController({
        config: () => ({ enabled: true, whisper_url: "http://127.0.0.1:8080" }),
        holdDelay: 10,
        startRecorder: async () => {
          starts++
          return { stop: async () => new Blob() }
        },
        transcribe: async () => "",
        onTranscript: () => {},
        onError: () => {},
      })
      const key = keyboardEvent()

      expect(voice.handleHoldKeyDown(key.event)).toBe(true)
      expect(voice.handleHoldKeyUp(key.event, () => spaces.push(" "))).toBe(true)

      expect(spaces).toEqual([" "])
      expect(starts).toBe(0)
      expect(key.preventDefaultCount()).toBe(2)
      dispose()
    })
  })

  test("stops and transcribes after hold-to-record release", async () => {
    await createRoot(async (dispose) => {
      const audio = new Blob([new Uint8Array([1])], { type: "audio/wav" })
      const transcripts: string[] = []
      const voice = createVoiceInputController({
        config: () => ({ enabled: true, whisper_url: "http://127.0.0.1:8080" }),
        holdDelay: 1,
        startRecorder: async () => ({ stop: async () => audio }),
        transcribe: async () => "held text",
        onTranscript: (text) => transcripts.push(text),
        onError: (error) => {
          throw error
        },
      })
      const key = keyboardEvent()

      expect(voice.handleHoldKeyDown(key.event)).toBe(true)
      await delay(5)
      expect(voice.recording()).toBe(true)
      expect(voice.handleHoldKeyUp(key.event, () => {})).toBe(true)
      await delay(5)

      expect(voice.recording()).toBe(false)
      expect(transcripts).toEqual(["held text"])
      dispose()
    })
  })

  test("posts base64 audio to the opencode transcription endpoint", async () => {
    let request: Request | undefined
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })
    const text = await transcribeVoice({
      serverUrl: "https://server.example.test",
      directory: "/repo",
      audio,
      auth: { url: "https://server.example.test", username: "u", password: "p" },
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json({ text: "hello" })
      },
    })

    expect(text).toBe("hello")
    expect(request?.url).toBe("https://server.example.test/experimental/voice/transcribe")
    expect(request?.headers.get("x-opencode-directory")).toBe("/repo")
    expect(request?.headers.get("authorization")).toBe("Basic dTpw")
    expect(await request?.json()).toEqual({ audio: "AQID", filename: "opencode-voice.wav", mime: "audio/wav" })
  })
})
