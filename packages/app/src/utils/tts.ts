import { createSignal, onCleanup } from "solid-js"

// Text-to-Speech utility using Web Speech API (free, built into browsers)

export type TTSVoice = {
  name: string
  lang: string
  default: boolean
  localService: boolean
}

// Clean text for better TTS output
function cleanTextForSpeech(text: string): string {
  return (
    text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, " code block ")
      // Remove inline code
      .replace(/`[^`]+`/g, " code ")
      // Remove markdown headers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove markdown bold/italic
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // Remove markdown links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove HTML tags
      .replace(/<[^>]+>/g, "")
      // Remove excess whitespace
      .replace(/\s+/g, " ")
      .trim()
  )
}

export function createTTS() {
  const hasSupport = typeof window !== "undefined" && "speechSynthesis" in window

  const [isEnabled, setIsEnabled] = createSignal(true)
  const [isSpeaking, setIsSpeaking] = createSignal(false)
  const [isPaused, setIsPaused] = createSignal(false)
  const [voices, setVoices] = createSignal<TTSVoice[]>([])
  const [selectedVoice, setSelectedVoice] = createSignal("")
  const [rate, setRate] = createSignal(1)
  const [volume, setVolume] = createSignal(1)
  const [pitch, setPitch] = createSignal(1)
  const [lastSpokenText, setLastSpokenText] = createSignal<string | undefined>(undefined)

  let utteranceQueue: SpeechSynthesisUtterance[] = []
  let currentUtterance: SpeechSynthesisUtterance | undefined

  // Load available voices
  if (hasSupport) {
    const loadVoices = () => {
      try {
        const availableVoices = window.speechSynthesis.getVoices()
        setVoices(
          availableVoices.map((v) => ({
            name: v.name,
            lang: v.lang,
            default: v.default,
            localService: v.localService,
          })),
        )

        // Select a good default voice (prefer Ava, then other Neural voices)
        if (!selectedVoice() && availableVoices.length > 0) {
          const preferred =
            // First try to find Microsoft Ava
            availableVoices.find((v) => v.name.includes("Ava") && v.lang.startsWith("en")) ||
            // Then other Neural/Natural voices
            availableVoices.find(
              (v) => v.lang.startsWith("en") && (v.name.includes("Neural") || v.name.includes("Natural")),
            ) ||
            availableVoices.find((v) => v.lang.startsWith("en") && v.default) ||
            availableVoices.find((v) => v.lang.startsWith("en")) ||
            availableVoices[0]

          if (preferred) {
            setSelectedVoice(preferred.name)
          }
        }
      } catch {
        // Silently ignore voice loading errors
      }
    }

    // Voices may load async
    try {
      loadVoices()
      window.speechSynthesis.onvoiceschanged = loadVoices
    } catch {
      // Silently ignore if voice change listener fails
    }
  }

  const getVoiceObject = () => {
    if (!hasSupport) return undefined
    const voiceName = selectedVoice()
    return window.speechSynthesis.getVoices().find((v) => v.name === voiceName)
  }

  // Internal speak function that doesn't check isEnabled
  const speakText = (cleanedText: string) => {
    if (!hasSupport) return

    const utterance = new SpeechSynthesisUtterance(cleanedText)

    const voice = getVoiceObject()
    if (voice) utterance.voice = voice

    utterance.rate = rate()
    utterance.pitch = pitch()
    utterance.volume = volume()

    utterance.onstart = () => {
      setIsSpeaking(true)
      setIsPaused(false)
    }
    utterance.onend = () => {
      setIsSpeaking(false)
      setIsPaused(false)
      currentUtterance = undefined
      processQueue()
    }
    utterance.onerror = () => {
      setIsSpeaking(false)
      setIsPaused(false)
      currentUtterance = undefined
      processQueue()
    }
    utterance.onpause = () => setIsPaused(true)
    utterance.onresume = () => setIsPaused(false)

    utteranceQueue.push(utterance)
    try {
      processQueue()
    } catch {
      // Silently ignore queue processing errors
    }
  }

  const speak = (text: string, saveForReplay = true) => {
    if (!hasSupport || !isEnabled()) return

    const cleanedText = cleanTextForSpeech(text)
    if (!cleanedText.trim()) return

    if (saveForReplay) {
      setLastSpokenText(cleanedText)
    }

    speakText(cleanedText)
  }

  const processQueue = () => {
    if (currentUtterance || utteranceQueue.length === 0) return
    if (isPaused()) return

    currentUtterance = utteranceQueue.shift()
    if (currentUtterance) {
      try {
        window.speechSynthesis.speak(currentUtterance)
      } catch {
        currentUtterance = undefined
        setIsSpeaking(false)
      }
    }
  }

  const pause = () => {
    if (!hasSupport || !isSpeaking()) return
    try {
      window.speechSynthesis.pause()
      setIsPaused(true)
    } catch {
      // Silently ignore pause errors
    }
  }

  const resume = () => {
    if (!hasSupport || !isPaused()) return
    try {
      window.speechSynthesis.resume()
      setIsPaused(false)
    } catch {
      // Silently ignore resume errors
    }
  }

  const togglePause = () => {
    if (isPaused()) {
      resume()
    } else {
      pause()
    }
  }

  const stop = () => {
    if (!hasSupport) return
    try {
      window.speechSynthesis.cancel()
    } catch {
      // Silently ignore cancel errors
    }
    utteranceQueue = []
    currentUtterance = undefined
    setIsSpeaking(false)
    setIsPaused(false)
  }

  const toggle = () => {
    const next = !isEnabled()
    setIsEnabled(next)
    if (!next) stop()
    return next
  }

  const enable = () => {
    setIsEnabled(true)
  }

  const disable = () => {
    setIsEnabled(false)
    stop()
  }

  const queueLength = () => utteranceQueue.length

  const replay = () => {
    const text = lastSpokenText()
    if (!hasSupport || !text) return
    stop()
    // Force speak even if TTS is disabled (for replay)
    speakText(text)
  }

  const canReplay = () => !!lastSpokenText()

  onCleanup(() => {
    stop()
  })

  return {
    isSupported: () => hasSupport,
    isEnabled,
    isSpeaking,
    isPaused,
    voices,
    selectedVoice,
    setVoice: setSelectedVoice,
    rate,
    setRate,
    volume,
    setVolume,
    pitch,
    setPitch,
    speak,
    pause,
    resume,
    togglePause,
    stop,
    toggle,
    enable,
    disable,
    queueLength,
    replay,
    canReplay,
  }
}

// Singleton for app-wide TTS
let globalTTS: ReturnType<typeof createTTS> | undefined

export function getGlobalTTS() {
  if (!globalTTS) {
    globalTTS = createTTS()
  }
  return globalTTS
}
