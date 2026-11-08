import type { OpenString } from "./options.js"

/**
 * The models.dev v2 API protocols the package implements. A model names the one it speaks; text models with one of
 * the first seven run on the package's standard implementation unless their provider attached its own dialect.
 */
export type ApiName =
  | "chat-completions"
  | "responses"
  | "messages"
  | "converse"
  | "generate-content"
  | "interactions"
  | "cohere-chat"
  | "systemone"
  | "decisions"
  | "workers-ai-run"
  | "images"
  | "videos"
  | "speech"
  | "transcriptions"

/** A model's API: a models.dev v2 protocol name, or a custom route's protocol id. */
export type Api = OpenString<ApiName>

// Every media protocol id, by the models.dev v2 API it speaks. Text protocols name theirs in `Protocol.api`.
const media: Record<string, ApiName> = {
  "google-images": "generate-content",
  "google-speech": "generate-content",
  "google-transcription": "generate-content",
  "system-one": "systemone",
  "baseten-system-one": "systemone",
  "openai-decisions": "decisions",
  "cloudflare-run-decisions": "workers-ai-run",
  "cloudflare-run-extraction": "workers-ai-run",
  "cloudflare-workers-ai-images": "workers-ai-run",
  "openai-images": "images",
  "xai-images": "images",
  "zai-images": "images",
  "alibaba-images": "images",
  "minimax-images": "images",
  "meta-images": "images",
  "xai-video": "videos",
  "runway-video": "videos",
  "google-video": "videos",
  "openai-speech": "speech",
  "elevenlabs-speech": "speech",
  "cartesia-speech": "speech",
  "deepgram-speech": "speech",
  "openai-transcription": "transcriptions",
  "elevenlabs-transcription": "transcriptions",
  "deepgram-transcription": "transcriptions",
  "assemblyai-transcription": "transcriptions",
}

/** The API a media or decision protocol speaks; a protocol the package doesn't know keeps its own id. */
export const mediaApi = (protocol: string): Api => media[protocol] ?? protocol
