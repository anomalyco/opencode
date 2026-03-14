import { Auth } from "@/auth"
import type { VoiceProvider } from "./provider"

export namespace GroqVoice {
  const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

  export async function create(): Promise<VoiceProvider.Provider> {
    return {
      id: "groq",
      name: "Groq Whisper",
      async isAvailable() {
        const auth = await Auth.get("groq")
        return !!auth
      },
      async transcribe(audio: Buffer, config?: VoiceProvider.Config): Promise<VoiceProvider.TranscriptionResult> {
        const auth = await Auth.get("groq")
        if (!auth || auth.type !== "api") {
          throw new Error("Groq API key not configured. Run /connect groq")
        }

        const formData = new FormData()
        formData.append("file", new Blob([new Uint8Array(audio)]), "audio.wav")
        formData.append("model", config?.model ?? "whisper-large-v3")
        formData.append("temperature", String(config?.temperature ?? 0))
        formData.append("response_format", "verbose_json")
        if (config?.language) {
          formData.append("language", config.language)
        }

        const response = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.key}`,
          },
          body: formData,
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Groq transcription failed: ${response.status} ${error}`)
        }

        const result = await response.json() as {
          text: string
          duration?: number
          language?: string
        }

        return {
          text: result.text,
          duration: result.duration,
          language: result.language,
        }
      },
    }
  }
}
