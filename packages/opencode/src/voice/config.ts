import type { Info } from "@/config/config"

type Voice = Info["voice"]

export type AudioInputFormat = "input_audio" | "audio_url"

export function providerType(voice: Voice, fallback?: Voice): "whisper" | "lalm" {
  return voice?.type ?? fallback?.type ?? "lalm"
}

export function lalm(voice: Voice) {
  const model = voice?.lalm?.model
  if (!model) {
    return {
      ok: false as const,
      message: "Missing voice.lalm.model (format: provider/model, e.g. openai/gpt-4o-audio-preview)",
    }
  }
  return { ok: true as const, config: { ...(voice?.lalm ?? {}), model } }
}

export function audioInputFormat(voice: Voice): AudioInputFormat {
  return voice?.lalm?.audio_input_format ?? "input_audio"
}

export function whisper(voice: Voice) {
  const apiKey = voice?.whisper?.apiKey
  if (!apiKey) {
    return { ok: false as const, message: "Missing voice.whisper.apiKey" }
  }
  return { ok: true as const, config: { ...(voice?.whisper ?? {}), apiKey } }
}

export function status(voice: Voice) {
  const type = providerType(voice)
  const result = type === "lalm" ? lalm(voice) : whisper(voice)
  if (result.ok) return { ok: true as const, type }
  return { ok: false as const, type, message: result.message }
}

export * as VoiceConfig from "./config"
