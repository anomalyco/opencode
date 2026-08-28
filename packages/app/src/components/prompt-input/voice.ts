import { createSignal, onCleanup } from "solid-js"
import { getSpeechRecognitionCtor } from "@/utils/runtime-adapters"

export type VoiceErrorKind =
  | "not-allowed"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "service-not-allowed"
  | "aborted"
  | "language-not-supported"
  | "unknown"

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export type VoiceInputOptions = {
  lang: () => string
  onFinal: (text: string) => void
  onError: (kind: VoiceErrorKind) => void
}

const LOCALE_TAGS: Record<string, string> = {
  ru: "ru-RU",
  uk: "uk-UA",
  en: "en-US",
  zh: "zh-CN",
  zht: "zh-TW",
  ko: "ko-KR",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  da: "da-DK",
  ja: "ja-JP",
  pl: "pl-PL",
  ar: "ar-SA",
  no: "nb-NO",
  br: "pt-BR",
  th: "th-TH",
  bs: "bs-BA",
  tr: "tr-TR",
  hi: "hi-IN",
  nl: "nl-NL",
  id: "id-ID",
  vi: "vi-VN",
  it: "it-IT",
  ur: "ur-PK",
  pa: "pa-IN",
  az: "az-AZ",
  fi: "fi-FI",
  sv: "sv-SE",
  am: "am-ET",
  cs: "cs-CZ",
  hu: "hu-HU",
  ro: "ro-RO",
  ca: "ca-ES",
  sk: "sk-SK",
}

const fallbackLang = () =>
  typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language
    ? navigator.language
    : "en-US"

export function createVoiceInput(options: VoiceInputOptions) {
  const supported =
    typeof window !== "undefined" && typeof getSpeechRecognitionCtor<SpeechRecognitionLike>(window) !== "undefined"
  const [listening, setListening] = createSignal(false)

  let recognition: SpeechRecognitionLike | undefined
  let active = false
  let disposed = false

  const speechLang = () => {
    const locale = options.lang()
    const base = locale.split("-")[0]?.toLowerCase() ?? ""
    return LOCALE_TAGS[base] ?? fallbackLang()
  }

  const ensure = () => {
    if (recognition) return recognition
    const Ctor = getSpeechRecognitionCtor<SpeechRecognitionLike>(window)
    if (!Ctor) throw new Error("Speech recognition is not supported")
    const rec = new Ctor()
    rec.lang = speechLang()
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (event) => {
      const results = event.results
      for (let i = event.resultIndex; i < results.length; i++) {
        const result = results[i]
        if (!result.isFinal) continue
        const text = String(result[0]?.transcript ?? "").trim()
        if (text) options.onFinal(text)
      }
    }
    rec.onerror = (event) => {
      const kind = String(event.error ?? "unknown")
      const interrupted = kind === "aborted" || kind === "no-speech"
      active = false
      setListening(false)
      if (!disposed && !interrupted) options.onError(kind as VoiceErrorKind)
    }
    rec.onend = () => {
      const wasActive = active
      active = false
      setListening(false)
      if (wasActive && !disposed) {
        try {
          rec.start()
          active = true
          setListening(true)
        } catch {
          // restart failed, surface as generic error
          options.onError("unknown")
        }
      }
    }
    recognition = rec
    return rec
  }

  const start = () => {
    if (!supported || active || disposed) return
    try {
      const rec = ensure()
      active = true
      setListening(true)
      rec.start()
    } catch {
      active = false
      setListening(false)
      options.onError("unknown")
    }
  }

  const stop = () => {
    if (!recognition || !active) return
    active = false
    setListening(false)
    try {
      recognition.stop()
    } catch {
      try {
        recognition.abort()
      } catch {
        // ignore
      }
    }
  }

  const toggle = () => {
    if (active) {
      stop()
      return
    }
    start()
  }

  onCleanup(() => {
    disposed = true
    stop()
  })

  return { supported: () => supported, listening, toggle, start, stop }
}
