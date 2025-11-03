import { Config } from "../config/config"
import { Auth } from "../auth"
import { Log } from "./log"
import { NamedError } from "./error"

export namespace Whisper {
  const log = Log.create({ service: "whisper" })

  export class ConfigError extends NamedError {
    constructor() {
      super("WhisperConfigError", "OpenAI API key not configured. Run: opencode auth login")
    }
  }

  export async function transcribe(audioBlob: Blob): Promise<string> {
    // Get OpenAI API key from auth (same as provider)
    const auth = await Auth.get("openai")
    const config = await Config.get()
    
    // Use auth key first, fall back to config.whisper.apiKey
    const apiKey = auth?.type === "api" ? auth.key : config.whisper?.apiKey
    
    if (!apiKey) {
      log.error("no OpenAI API key found in auth or config")
      throw new ConfigError()
    }

    const baseURL = config.whisper?.baseURL ?? "https://api.openai.com/v1"
    const model = config.whisper?.model ?? "whisper-1"

    const formData = new FormData()
    formData.append("file", audioBlob, "recording.wav")
    formData.append("model", model)

    log.info("transcribing audio", { model, size: audioBlob.size, type: audioBlob.type })

    const response = await fetch(`${baseURL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.text()
      log.error("transcription failed", { status: response.status, error })
      throw new Error(`Whisper API error (${response.status}): ${error}`)
    }

    const result = await response.json()
    log.info("transcription complete", { text: result.text })
    
    if (!result.text) {
      log.error("no text in response", { result })
      throw new Error("No transcription text returned")
    }
    
    return result.text
  }
}

