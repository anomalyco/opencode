import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { TranscriptionLanguage } from "@/context/settings"
import type { PromptInputV2VoiceInputState } from "@opencode-ai/session-ui/v2/prompt-input"

type Status = PromptInputV2VoiceInputState

export function createMediaRecorderInput(input: {
  serverUrl: () => string
  directory: () => string
  providerID: () => string | undefined
  modelID: () => string
  language: () => TranscriptionLanguage
  onError: (message: string) => void
}) {
  const supported =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  const [state, setState] = createStore({ status: "idle" as Status, levels: Array.from({ length: 16 }, () => 0) })
  let active = false
  let starting = false
  let recorder: MediaRecorder | undefined
  let stream: MediaStream | undefined
  let chunks: Blob[] = []
  let audioContext: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let levelsFrame: number | undefined
  let resolveStop: ((value: string) => void) | undefined

  const finish = (text: string) => {
    if (levelsFrame !== undefined) cancelAnimationFrame(levelsFrame)
    levelsFrame = undefined
    void audioContext?.close()
    audioContext = undefined
    analyser = undefined
    setState("levels", Array.from({ length: 16 }, () => 0))
    setState("status", "idle")
    resolveStop?.(text)
    resolveStop = undefined
  }

  const transcribe = async (blob: Blob) => {
    const url = new URL("/api/audio/transcribe", input.serverUrl())
    const providerID = input.providerID()
    if (providerID) url.searchParams.set("provider", providerID)
    url.searchParams.set("model", input.modelID())
    url.searchParams.set("language", input.language())
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "audio/webm",
        "X-Filename": `voice.${blob.type.includes("mp4") ? "mp4" : "webm"}`,
        "x-opencode-directory": input.directory(),
      },
      body: blob,
    })
    const result: unknown = await response.json()
    if (!response.ok) {
      const message = isRecord(result) && typeof result.error === "string" ? result.error : "Transcription failed"
      throw new Error(message)
    }
    if (!isRecord(result) || typeof result.text !== "string") throw new Error("Transcription returned no text")
    return result.text.trim()
  }

  const stopTracks = () => {
    stream?.getTracks().forEach((track) => track.stop())
    stream = undefined
  }

  const updateLevels = () => {
    if (!analyser || state.status !== "recording") return
    const values = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(values)
    setState(
      "levels",
      Array.from({ length: 16 }, (_, index) => {
        const start = Math.floor((index * values.length) / 16)
        const end = Math.max(start + 1, Math.floor(((index + 1) * values.length) / 16))
        const average = values.slice(start, end).reduce((sum, value) => sum + value, 0) / (end - start)
        return average / 255
      }),
    )
    levelsFrame = requestAnimationFrame(updateLevels)
  }

  const stopRecorder = () => {
    if (!recorder || recorder.state === "inactive") return
    recorder.stop()
  }

  const begin = async () => {
    starting = true
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!active) {
        starting = false
        stopTracks()
        finish("")
        return
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((value) =>
        MediaRecorder.isTypeSupported(value),
      )
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunks = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        stopTracks()
        recorder = undefined
        finish("")
        input.onError("Unable to record audio")
      }
      recorder.onstop = () => {
        const audio = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" })
        stopTracks()
        recorder = undefined
        chunks = []
        if (audio.size === 0) {
          finish("")
          return
        }
        void transcribe(audio)
          .then(finish)
          .catch((error: unknown) => {
            finish("")
            input.onError(error instanceof Error ? error.message : "Transcription failed")
          })
      }
      recorder.start()
      if (typeof AudioContext !== "undefined") {
        audioContext = new AudioContext()
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 128
        audioContext.createMediaStreamSource(stream).connect(analyser)
        updateLevels()
      }
      starting = false
      if (!active) stopRecorder()
    } catch (error) {
      starting = false
      active = false
      stopTracks()
      finish("")
      input.onError(error instanceof Error ? error.message : "Microphone access was denied")
    }
  }

  onCleanup(() => {
    active = false
    stopRecorder()
    stopTracks()
  })

  return {
    supported,
    state: () => state.status,
    levels: () => state.levels,
    start() {
      if (!supported || active || state.status !== "idle") return
      active = true
      setState("status", "recording")
      void begin()
    },
    stop() {
      if (!supported || !active) return Promise.resolve("")
      active = false
      setState("status", "processing")
      const result = new Promise<string>((resolve) => {
        resolveStop = resolve
      })
      if (!starting) stopRecorder()
      return result
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
