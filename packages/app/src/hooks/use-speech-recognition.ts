import { createSignal, createEffect, onCleanup } from "solid-js"

export type SpeechRecognitionState = "idle" | "recording" | "error"

export interface UseSpeechRecognitionOptions {
  lang?: string
  onResult?: (text: string, isFinal: boolean) => void
  onError?: (error: string) => void
  onStart?: () => void
  onEnd?: () => void
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const [state, setState] = createSignal<SpeechRecognitionState>("idle")
  const [transcript, setTranscript] = createSignal("")
  const [isSupported, setIsSupported] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  let recognition: SpeechRecognition | null = null
  let isAborted = false

  createEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      setIsSupported(false)
      return
    }

    setIsSupported(true)

    recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = options.lang || navigator.language || "en-US"

    recognition.onstart = () => {
      isAborted = false
      setState("recording")
      setError(null)
      options.onStart?.()
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (isAborted) return

      let finalTranscript = ""
      let interimTranscript = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
        } else {
          interimTranscript += result[0].transcript
        }
      }

      const fullTranscript = finalTranscript || interimTranscript
      setTranscript(fullTranscript)
      options.onResult?.(fullTranscript, !!finalTranscript)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (isAborted) return

      const errorMsg =
        event.error === "not-allowed" ? "Microphone access denied" : `Speech recognition error: ${event.error}`
      setError(errorMsg)
      setState("error")
      options.onError?.(errorMsg)
    }

    recognition.onend = () => {
      if (state() === "recording") {
        setState("idle")
      }
      options.onEnd?.()
    }

    onCleanup(() => {
      if (recognition) {
        recognition.stop()
        recognition = null
      }
    })
  })

  const start = () => {
    if (!recognition || state() === "recording") return

    try {
      isAborted = false
      recognition.start()
    } catch (err) {
      setError("Failed to start recording")
      setState("error")
    }
  }

  const stop = () => {
    if (!recognition || state() !== "recording") return

    try {
      recognition.stop()
      setState("idle")
    } catch (err) {
      // Ignore errors when stopping
    }
  }

  const abort = () => {
    isAborted = true
    stop()
    setTranscript("")
    setError(null)
  }

  const toggle = () => {
    if (state() === "recording") {
      stop()
    } else {
      start()
    }
  }

  const reset = () => {
    setTranscript("")
    setError(null)
    setState("idle")
  }

  return {
    state,
    transcript,
    isSupported,
    error,
    start,
    stop,
    abort,
    toggle,
    reset,
  }
}
