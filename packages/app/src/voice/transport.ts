import { ollamaURL } from "../ollama/types"
import {
  voiceAdapter,
  qwenVoiceLanguages,
  voiceCapabilities,
  voiceRequestLanguage,
  type VoiceLanguage,
  type VoiceProviderConfig,
  type VoiceResult,
} from "./types"

export async function transcribeVoiceEndpoint(input: {
  provider: VoiceProviderConfig
  modelID: string
  audio: ArrayBuffer
  language: VoiceLanguage
  apiKey?: string
  signal: AbortSignal
  fetch?: typeof fetch
}): Promise<VoiceResult<string>> {
  const capabilities = voiceCapabilities(input.provider, input.modelID)
  if (input.signal.aborted) return { ok: false, error: "cancelled" }
  if (input.audio.byteLength > capabilities.maxBytes || !input.audio.byteLength) return { ok: false, error: "audio" }
  return endpointAdapters[voiceAdapter(input.provider)](input)
}

const endpointAdapters = { "ollama-qwen": transcribeOllamaAudio, "transcription-api": transcribeMultipart }

async function transcribeMultipart(input: Parameters<typeof transcribeVoiceEndpoint>[0]): Promise<VoiceResult<string>> {
  const body = new FormData()
  body.append("file", new Blob([input.audio], { type: "audio/wav" }), "recording.wav")
  body.append("model", input.modelID)
  body.append("response_format", "json")
  const language = voiceRequestLanguage(voiceCapabilities(input.provider, input.modelID), input.language)
  if (language !== "auto") body.append("language", language)
  try {
    const response = await (input.fetch ?? fetch)(
      `${input.provider.baseURL.replace(/\/+$/, "")}/audio/transcriptions`,
      {
        method: "POST",
        body,
        signal: input.signal,
        redirect: "error",
        headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {},
      },
    )
    if (response.status === 401 || response.status === 403) return { ok: false, error: "authentication" }
    if (!response.ok) return { ok: false, error: "response" }
    const result: unknown = await response.json()
    if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string")
      return { ok: false, error: "response" }
    const text = result.text.trim()
    return text ? { ok: true, value: text } : { ok: false, error: "empty" }
  } catch {
    return { ok: false, error: input.signal.aborted ? "cancelled" : "network" }
  }
}

// Qwen3-ASR uses Ollama's native audio projector endpoints.
async function transcribeOllamaAudio(
  input: Parameters<typeof transcribeVoiceEndpoint>[0],
): Promise<VoiceResult<string>> {
  const bytes = new Uint8Array(input.audio)
  const view = new DataView(input.audio)
  if (
    bytes.length < 44 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WAVE" ||
    String.fromCharCode(...bytes.slice(36, 40)) !== "data" ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== 16000 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== bytes.length - 44
  )
    return { ok: false, error: "audio" }
  const language = input.language === "auto" ? undefined : qwenVoiceLanguages[input.language]
  if (input.language !== "auto" && !language) return { ok: false, error: "configuration" }
  const seconds = input.provider.models.find((model) => model.id === input.modelID)?.chunkSeconds ?? 30
  const chunkSize = (seconds === 15 || seconds === 60 ? seconds : 30) * 32000
  const texts: string[] = []
  try {
    for (let offset = 44; offset < bytes.length; offset += chunkSize) {
      if (input.signal.aborted) return { ok: false, error: "cancelled" }
      const audio = new Uint8Array(44 + Math.min(chunkSize, bytes.length - offset))
      audio.set(bytes.subarray(0, 44))
      audio.set(bytes.subarray(offset, offset + chunkSize), 44)
      const header = new DataView(audio.buffer)
      header.setUint32(4, audio.length - 8, true)
      header.setUint32(40, audio.length - 44, true)
      const binary: string[] = []
      for (let index = 0; index < audio.length; index += 8192)
        binary.push(String.fromCharCode(...audio.subarray(index, index + 8192)))
      const response = await (input.fetch ?? fetch)(
        `${ollamaURL(input.provider.baseURL)}/api/${language ? "generate" : "chat"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: input.modelID,
            stream: false,
            // Legacy Ollama chat templates discard assistant prefill. Raw generation keeps
            // Qwen's language prefix immediately after the audio and assistant boundary.
            ...(language
              ? {
                  raw: true,
                  prompt: `<|im_start|>system\n<|im_end|>\n<|im_start|>user\n[img-0]<|im_end|>\n<|im_start|>assistant\nlanguage ${language}<asr_text>`,
                  images: [btoa(binary.join(""))],
                }
              : {
                  messages: [{ role: "user", content: "", images: [btoa(binary.join(""))] }],
                }),
          }),
          signal: input.signal,
          redirect: "error",
        },
      )
      if ([401, 403].includes(response.status)) return { ok: false, error: "authentication" }
      if (!response.ok) return { ok: false, error: "response" }
      const data: unknown = await response.json()
      if (!data || typeof data !== "object") return { ok: false, error: "response" }
      const content = language
        ? "response" in data && typeof data.response === "string"
          ? data.response
          : undefined
        : "message" in data &&
            data.message &&
            typeof data.message === "object" &&
            "content" in data.message &&
            typeof data.message.content === "string"
          ? data.message.content
          : undefined
      if (content === undefined) return { ok: false, error: "response" }
      const marker = content.indexOf("<asr_text>")
      if (marker < 0 && !language) return { ok: false, error: "response" }
      const text = (marker < 0 ? content : content.slice(marker + "<asr_text>".length))
        .replace(/<\|[^>]*\|>/g, "")
        .trim()
      if (text) texts.push(text)
    }
    return texts.length ? { ok: true, value: texts.join(" ") } : { ok: false, error: "empty" }
  } catch {
    return { ok: false, error: input.signal.aborted ? "cancelled" : "network" }
  }
}
