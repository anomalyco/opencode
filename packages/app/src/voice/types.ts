export const localVoiceModel = {
  providerID: "local-speech",
  modelID: "mlx-community/Qwen3-ASR-0.6B-8bit",
  name: "Qwen3-ASR 0.6B",
} as const

export type VoiceSelection = { providerID: string; modelID: string }
export type VoiceLanguage = string
export type VoiceAdapterID = "mlx-qwen" | "ollama-qwen" | "transcription-api"
export type VoiceCapabilities = {
  language: "automatic" | "selectable" | "unknown"
  languages?: string[]
  maxBytes: number
  timeout: number
  managed: boolean
}

// Canonical language names accepted by Qwen3-ASR's assistant prefix.
export const qwenVoiceLanguages: Record<string, string> = {
  ko: "Korean",
  en: "English",
  zh: "Chinese",
  yue: "Cantonese",
  ar: "Arabic",
  de: "German",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  id: "Indonesian",
  it: "Italian",
  ru: "Russian",
  th: "Thai",
  vi: "Vietnamese",
  ja: "Japanese",
  tr: "Turkish",
  hi: "Hindi",
  ms: "Malay",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  pl: "Polish",
  cs: "Czech",
  fil: "Filipino",
  fa: "Persian",
  el: "Greek",
  ro: "Romanian",
  hu: "Hungarian",
  mk: "Macedonian",
}

export const voiceAdapters: Record<VoiceAdapterID, VoiceCapabilities> = {
  "mlx-qwen": {
    language: "selectable",
    languages: ["ko", "en"],
    maxBytes: 25 * 1024 * 1024,
    timeout: 180000,
    managed: true,
  },
  "ollama-qwen": {
    language: "selectable",
    languages: Object.keys(qwenVoiceLanguages),
    maxBytes: 25 * 1024 * 1024,
    timeout: 600000,
    managed: false,
  },
  "transcription-api": { language: "unknown", maxBytes: 25 * 1024 * 1024, timeout: 180000, managed: false },
}

export function validVoiceLanguage(value: unknown): value is VoiceLanguage {
  return typeof value === "string" && (value === "auto" || /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value))
}

export function voiceAdapter(provider: VoiceProviderConfig): Exclude<VoiceAdapterID, "mlx-qwen">
export function voiceAdapter(provider?: VoiceProviderConfig): VoiceAdapterID
export function voiceAdapter(provider?: VoiceProviderConfig): VoiceAdapterID {
  if (!provider) return "mlx-qwen"
  // Existing saved connections retain their original transport.
  return provider.adapter ?? (provider.protocol === "ollama" ? "ollama-qwen" : "transcription-api")
}

export function voiceCapabilities(provider?: VoiceProviderConfig, modelID?: string): VoiceCapabilities {
  const adapter = voiceAdapters[voiceAdapter(provider)]
  const model = provider?.models.find((item) => item.id === modelID)
  if (voiceAdapter(provider) === "ollama-qwen" || adapter.language === "automatic" || !model?.languages) return adapter
  return { ...adapter, language: model.languages.length ? "selectable" : "automatic", languages: model.languages }
}

export function voiceRequestLanguage(capabilities: VoiceCapabilities, language: VoiceLanguage) {
  if (capabilities.language === "automatic" || !validVoiceLanguage(language)) return "auto"
  if (capabilities.languages && !capabilities.languages.includes(language)) return "auto"
  return language
}

export function supportsManagedVoice(environment: { platform: string; arch: string }) {
  return environment.platform === "darwin" && environment.arch === "arm64"
}
export type VoiceProviderConfig = {
  id: string
  name: string
  baseURL: string
  protocol?: "openai" | "ollama"
  adapter?: Exclude<VoiceAdapterID, "mlx-qwen">
  location?: "device" | "remote" | "cloud"
  models: { id: string; name: string; visible: boolean; chunkSeconds?: number; languages?: string[] }[]
  hasKey?: boolean
}
export type VoiceConfig = {
  providers: VoiceProviderConfig[]
  selected?: VoiceSelection
  language: VoiceLanguage
}
export type VoiceError =
  | "configuration"
  | "network"
  | "authentication"
  | "response"
  | "empty"
  | "cancelled"
  | "runtime"
  | "unsupported"
  | "storage"
  | "busy"
  | "audio"
export type VoiceResult<T> = { ok: true; value: T } | { ok: false; error: VoiceError }
export type VoiceLocalState = {
  supported: boolean
  phase: "uninstalled" | "installing" | "downloading" | "installed" | "loading" | "ready" | "error"
  progress?: number
  error?: VoiceError
}
export type VoiceSnapshot = VoiceConfig & { local: VoiceLocalState }
export type VoiceTranscription = { id: string; selection: VoiceSelection; audio: ArrayBuffer; language: VoiceLanguage }
export type VoicePlatform = {
  read(): Promise<VoiceSnapshot>
  save(provider: VoiceProviderConfig, apiKey?: string): Promise<VoiceResult<VoiceSnapshot>>
  remove(id: string): Promise<VoiceSnapshot>
  configure(selected: VoiceSelection | undefined, language: VoiceLanguage): Promise<VoiceSnapshot>
  test(id: string): Promise<VoiceResult<void>>
  install(): Promise<VoiceResult<void>>
  deleteModel(): Promise<VoiceResult<void>>
  transcribe(input: VoiceTranscription): Promise<VoiceResult<string>>
  cancel(id: string): Promise<void>
  subscribe(callback: (state: VoiceSnapshot) => void): () => void
}

export type MicrophonePlatform = {
  status(): Promise<"not-determined" | "granted" | "denied" | "restricted" | "unknown">
  openSettings(target: "privacy" | "input"): Promise<boolean>
}

export function validVoiceProvider(provider: VoiceProviderConfig) {
  if (!provider || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider.id) || provider.id === localVoiceModel.providerID)
    return false
  if (
    !provider.name?.trim() ||
    provider.name.length > 120 ||
    !Array.isArray(provider.models) ||
    !provider.models.length ||
    provider.models.length > 30
  )
    return false
  if (provider.adapter !== undefined && !["ollama-qwen", "transcription-api"].includes(provider.adapter)) return false
  if (
    provider.adapter &&
    provider.protocol &&
    (provider.adapter === "ollama-qwen") !== (provider.protocol === "ollama")
  )
    return false
  if (provider.location !== undefined && !["device", "remote", "cloud"].includes(provider.location)) return false
  if (
    provider.models.some(
      (model) =>
        model.languages !== undefined &&
        (!Array.isArray(model.languages) ||
          model.languages.length > 200 ||
          model.languages.some((value) => value === "auto" || !validVoiceLanguage(value))),
    )
  )
    return false
  if (provider.protocol !== undefined && !["openai", "ollama"].includes(provider.protocol)) return false
  if (provider.models.some((model) => model.chunkSeconds !== undefined && ![15, 30, 60].includes(model.chunkSeconds)))
    return false
  if (provider.models.some((model) => !model.id?.trim() || model.id.length > 200 || !model.name?.trim())) return false
  if (new Set(provider.models.map((model) => model.id)).size !== provider.models.length) return false
  try {
    const url = new URL(provider.baseURL)
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}
