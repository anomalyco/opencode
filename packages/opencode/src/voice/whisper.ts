import type { STTOptions, TranscriptionResult, AudioRecordingBuffer } from "./types"

export class WhisperClient {
  private options: STTOptions

  constructor(options?: Partial<STTOptions>) {
    this.options = {
      enabled: options?.enabled ?? true,
      provider: options?.provider ?? "whisper",
      endpoint: options?.endpoint ?? process.env.WHISPER_ENDPOINT ?? process.env.OPENAI_BASE_URL ?? "http://localhost:8000/v1",
      model: options?.model ?? process.env.WHISPER_MODEL ?? "whisper-large-v3",
      language: options?.language ?? "auto",
      translateToEnglish: options?.translateToEnglish ?? true,
      hotkey: options?.hotkey ?? "ctrl+v",
      apiKey: options?.apiKey ?? process.env.OPENAI_API_KEY,
    }
  }

  public async transcribe(audio: AudioRecordingBuffer): Promise<TranscriptionResult> {
    const isTranslation = Boolean(this.options.translateToEnglish)
    const endpointPath = isTranslation ? "/audio/translations" : "/audio/transcriptions"
    const url = `${this.options.endpoint?.replace(/\/$/, "")}${endpointPath}`

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(audio.pcmBuffer)], { type: "audio/wav" })
    formData.append("file", blob, "voice.wav")
    formData.append("model", this.options.model ?? "whisper-large-v3")

    if (this.options.language && this.options.language !== "auto" && !isTranslation) {
      formData.append("language", this.options.language)
    }

    formData.append("response_format", "verbose_json")

    const headers: Record<string, string> = {}
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Whisper STT request failed (${response.status}): ${errorText}`)
    }

    const result = (await response.json()) as {
      text: string
      language?: string
      duration?: number
    }

    return {
      text: result.text.trim(),
      language: result.language ?? this.options.language ?? "auto",
      durationSeconds: result.duration ?? audio.durationMs / 1000,
      task: isTranslation ? "translate" : "transcribe",
    }
  }
}
