import { createSignal, onCleanup } from "solid-js"
import { getSpeechRecognitionCtor } from "@/utils/runtime-adapters"

const WHISPER_MODEL = "onnx-community/whisper-large-v3-turbo"
const TRANSFORMERS_IMPORT = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0"

type VoiceInputStatus = "idle" | "recording" | "transcribing" | "error"

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>>
}

type SpeechRecognitionErrorEventLike = {
  error?: string
}

type TransformersModule = {
  env?: {
    allowLocalModels?: boolean
  }
  pipeline: (
    task: "automatic-speech-recognition",
    model: string,
    options: { device?: "webgpu" | "wasm" },
  ) => Promise<WhisperPipeline>
}

type WhisperPipeline = (
  audio: Float32Array,
  options: {
    chunk_length_s: number
    stride_length_s: number
    language?: string
    task: "transcribe"
  },
) => Promise<WhisperResult>

type WhisperResult = {
  text?: string
}

type VoiceInputOptions = {
  language: () => string
  onText: (text: string) => void
}

let whisperPipeline: Promise<WhisperPipeline> | undefined

export function createVoiceInput(options: VoiceInputOptions) {
  const [status, setStatus] = createSignal<VoiceInputStatus>("idle")
  const [error, setError] = createSignal("")
  let recorder: MediaRecorder | undefined
  let recognition: SpeechRecognitionLike | undefined
  let chunks: Blob[] = []

  const supported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia

  const stop = () => {
    if (recorder?.state === "recording") {
      recorder.stop()
      return
    }
    recognition?.stop()
  }

  const start = async () => {
    if (status() === "recording") {
      stop()
      return
    }
    if (status() === "transcribing") return

    setError("")
    try {
      await startWhisper()
    } catch (err) {
      console.warn("Local Whisper voice input unavailable, falling back to browser speech recognition.", err)
      startSpeechRecognition()
    }
  }

  const startWhisper = async () => {
    if (!supported()) throw new Error("Microphone capture is unavailable.")
    chunks = []
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return
      chunks.push(event.data)
    }
    recorder.onerror = () => {
      stream.getTracks().forEach((track) => track.stop())
      setError("prompt.voice.error")
      setStatus("error")
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      void transcribe(new Blob(chunks, { type: recorder?.mimeType || "audio/webm" }))
    }
    recorder.start()
    setStatus("recording")
  }

  const transcribe = async (blob: Blob) => {
    setStatus("transcribing")
    try {
      const pipeline = await loadWhisper()
      const result = await pipeline(await blobToMonoAudio(blob), {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: undefined,
        task: "transcribe",
      })
      const text = result.text?.trim()
      if (text) options.onText(text)
      setStatus("idle")
    } catch (err) {
      console.warn("Local Whisper transcription failed.", err)
      setError("prompt.voice.error")
      setStatus("error")
    }
  }

  const startSpeechRecognition = () => {
    const SpeechRecognition = getSpeechRecognitionCtor<SpeechRecognitionLike>(globalThis)
    if (!SpeechRecognition) {
      setError("prompt.voice.unsupported")
      setStatus("error")
      return
    }

    recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = options.language()
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .flatMap((result) => Array.from(result))
        .map((result) => result.transcript)
        .join(" ")
        .trim()
      if (text) options.onText(text)
    }
    recognition.onerror = () => {
      setError("prompt.voice.error")
      setStatus("error")
    }
    recognition.onend = () => {
      if (status() === "recording") setStatus("idle")
    }
    recognition.start()
    setStatus("recording")
  }

  onCleanup(() => {
    if (recorder?.state === "recording") recorder.stop()
    recognition?.stop()
  })

  return { status, error, supported, start }
}

async function loadWhisper() {
  whisperPipeline ??= import(/* @vite-ignore */ TRANSFORMERS_IMPORT).then(async (mod) => {
    const transformers = mod as TransformersModule
    if (transformers.env) transformers.env.allowLocalModels = false
    return transformers.pipeline("automatic-speech-recognition", WHISPER_MODEL, {
      device: typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm",
    })
  })
  return whisperPipeline
}

async function blobToMonoAudio(blob: Blob) {
  const context = new AudioContext({ sampleRate: 16000 })
  const buffer = await context.decodeAudioData(await blob.arrayBuffer())
  await context.close()
  return buffer.getChannelData(0)
}
