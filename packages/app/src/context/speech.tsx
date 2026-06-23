import { createSimpleContext } from "@opencode-ai/ui/context"
import { createSignal, onCleanup } from "solid-js"

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onaudioend: ((this: SpeechRecognition, ev: Event) => void) | null
  onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null
  onend: ((this: SpeechRecognition, ev: Event) => void) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
  onnomatch: ((this: SpeechRecognition, ev: Event) => void) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onsoundend: ((this: SpeechRecognition, ev: Event) => void) | null
  onsoundstart: ((this: SpeechRecognition, ev: Event) => void) | null
  onspeechend: ((this: SpeechRecognition, ev: Event) => void) | null
  onspeechstart: ((this: SpeechRecognition, ev: Event) => void) | null
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null
  abort(): void
  start(): void
  stop(): void
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export type SpeechRecognitionStatus = "idle" | "listening" | "processing" | "error"

export type SpeechRecognitionError = {
  error: string
  message: string
}

export type SpeechService = {
  isSupported: boolean
  status: () => SpeechRecognitionStatus
  transcript: () => string
  interimTranscript: () => string
  error: () => SpeechRecognitionError | null
  start: () => void
  stop: () => void
  abort: () => void
  reset: () => void
  setLanguage: (lang: string) => void
  language: () => string
}

function createSpeechService(): SpeechService {
  const win = window as WindowWithSpeechRecognition
  const SpeechRecognitionAPI = win.SpeechRecognition ?? win.webkitSpeechRecognition

  const isSupported = Boolean(SpeechRecognitionAPI)

  const [status, setStatus] = createSignal<SpeechRecognitionStatus>("idle")
  const [transcript, setTranscript] = createSignal("")
  const [interimTranscript, setInterimTranscript] = createSignal("")
  const [error, setError] = createSignal<SpeechRecognitionError | null>(null)
  const [language, setLanguage] = createSignal("en-US")

  let recognition: SpeechRecognition | null = null

  if (isSupported) {
    recognition = new SpeechRecognitionAPI()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setStatus("listening")
      setError(null)
    }

    recognition.onend = () => {
      setStatus("idle")
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setStatus("error")
      setError({
        error: event.error,
        message: event.message,
      })
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ""
      let final = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }

      if (final) {
        setTranscript((prev) => prev + final)
      }
      setInterimTranscript(interim)
    }

    recognition.onspeechstart = () => {
      setStatus("listening")
    }

    recognition.onspeechend = () => {
      setStatus("processing")
    }
  }

  onCleanup(() => {
    if (recognition) {
      recognition.abort()
      recognition = null
    }
  })

  const start = () => {
    if (!recognition) return
    if (status() === "listening") return

    setError(null)
    setTranscript("")
    setInterimTranscript("")
    recognition.lang = language()
    recognition.start()
  }

  const stop = () => {
    if (!recognition) return
    recognition.stop()
  }

  const abort = () => {
    if (!recognition) return
    recognition.abort()
    setStatus("idle")
  }

  const reset = () => {
    setTranscript("")
    setInterimTranscript("")
    setError(null)
    setStatus("idle")
  }

  const setLang = (lang: string) => {
    setLanguage(lang)
    if (recognition) {
      recognition.lang = lang
    }
  }

  return {
    isSupported,
    status,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    abort,
    reset,
    setLanguage: setLang,
    language,
  }
}

export const { use: useSpeech, provider: SpeechProvider } = createSimpleContext({
  name: "Speech",
  init: () => createSpeechService(),
})