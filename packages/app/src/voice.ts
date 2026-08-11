export const LOCAL_VOICE_MODELS = ["tiny", "base", "small", "large-v3-turbo-q5"] as const

export type LocalVoiceModel = (typeof LOCAL_VOICE_MODELS)[number]

export type LocalVoiceModelState = {
  size: number
  installed: boolean
  download?: {
    received: number
    total: number
  }
}

export type LocalVoiceState = {
  runtime: boolean
  transcribing: boolean
  models: Record<LocalVoiceModel, LocalVoiceModelState>
}

export type LocalVoicePlatform = {
  state(): Promise<LocalVoiceState>
  subscribe(callback: (state: LocalVoiceState) => void): () => void
  download(model: LocalVoiceModel): Promise<void>
  cancelDownload(model: LocalVoiceModel): Promise<void>
  remove(model: LocalVoiceModel): Promise<void>
  transcribe(input: { model: LocalVoiceModel; audio: ArrayBuffer }): Promise<string>
  cancelTranscription(): Promise<void>
}

export function withVoiceTranscriptSpacing(text: string, cursor: number | undefined, transcript: string) {
  const position = Math.max(0, Math.min(cursor ?? text.length, text.length))
  const before = position > 0 && !/\s/.test(text[position - 1]) ? " " : ""
  const after = position < text.length && !/\s/.test(text[position]) ? " " : ""
  return `${before}${transcript.trim()}${after}`
}
