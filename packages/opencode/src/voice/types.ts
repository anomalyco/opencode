export interface STTOptions {
  enabled: boolean
  provider: "whisper" | "faster-whisper" | "api"
  endpoint?: string
  model?: string
  language?: string // "auto" | "ta" | "en" | "hi" | "es" | "fr" | "zh" etc.
  translateToEnglish?: boolean // If true, uses task="translate"
  hotkey?: string
  apiKey?: string
}

export interface TranscriptionResult {
  text: string
  language?: string
  confidence?: number
  durationSeconds?: number
  task: "transcribe" | "translate"
}

export interface AudioRecordingBuffer {
  pcmBuffer: Buffer
  sampleRate: number
  channels: number
  durationMs: number
}
