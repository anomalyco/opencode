import { voiceLogStage } from "./log"
import { voiceSidecarBaseUrl } from "./play"

export type VoiceAckResult = { text: string; skip?: false } | { skip: true }

export type VoiceProgressSnapshot = {
  reads: number
  searches: number
  lists: number
  shell: number
  thinking: boolean
}

export type VoiceDecideResult = {
  intent: "command" | "stop" | "status" | "redirect" | "reply"
  reply?: "yes" | "no"
  speak?: string
}

export type VoiceFinalSpeakPlan = {
  parts: string[]
  hasOffer: boolean
  fullText: string
  closingQuestion?: string | null
  actionOffer?: boolean
}

export type VoiceContinuationChunk = {
  chunk: string
  done: boolean
  offer?: string
}

function sidecarBase(sidecarUrl?: string) {
  return (sidecarUrl ?? voiceSidecarBaseUrl()).replace(/\/+$/, "")
}

async function postJson<T>(base: string, path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${base}${path}`
  voiceLogStage("API", `POST ${path} body=${JSON.stringify(body).slice(0, 120)}`)
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  let data: Record<string, unknown> = {}
  if (raw) {
    try {
      data = JSON.parse(raw) as Record<string, unknown>
    } catch {
      voiceLogStage("API", `${path} invalid JSON status=${res.status} raw=${raw.slice(0, 200)}`)
      throw new Error(`voice request invalid JSON (${res.status})`)
    }
  }
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `voice request failed (${res.status})`
    voiceLogStage("API", `${path} error status=${res.status} ${message}`)
    throw new Error(message)
  }
  const summary =
    path === "/voice/speak" && typeof data.data === "string"
      ? `format=${String(data.format)} b64=${data.data.length}`
      : path === "/voice/final-speak" && Array.isArray(data.parts)
        ? `parts=${data.parts.length}`
        : `keys=${Object.keys(data).join(",")}`
  voiceLogStage("API", `${path} ok ${summary}`)
  return data as T
}

export async function fetchVoiceAck(input?: {
  sidecarUrl?: string
  text?: string
  progress?: VoiceProgressSnapshot
  periodic?: boolean
}) {
  return postJson<VoiceAckResult>(sidecarBase(input?.sidecarUrl), "/voice/ack", {
    text: input?.text ?? "",
    progress: input?.progress,
    periodic: input?.periodic ?? false,
  })
}

export async function fetchVoiceDecide(input: {
  sidecarUrl?: string
  text: string
  phase: string
  pendingOffer?: boolean
  lastSpoken?: string
  progress?: VoiceProgressSnapshot
}) {
  return postJson<VoiceDecideResult>(sidecarBase(input.sidecarUrl), "/voice/decide", {
    text: input.text,
    phase: input.phase,
    pendingOffer: input.pendingOffer ?? false,
    lastSpoken: input.lastSpoken ?? "",
    progress: input.progress,
  })
}

export async function fetchVoiceFinalSpeak(input: { sidecarUrl?: string; text: string }) {
  return postJson<VoiceFinalSpeakPlan>(sidecarBase(input.sidecarUrl), "/voice/final-speak", {
    text: input.text,
  })
}

export async function fetchVoiceSpeak(input: { sidecarUrl?: string; text: string; raw?: boolean }) {
  return postJson<{ text: string; format: string; encoding: string; data: string }>(
    sidecarBase(input.sidecarUrl),
    "/voice/speak",
    { text: input.text, raw: input.raw ?? false },
  )
}

export async function fetchVoiceContinuationChunk(input: {
  sidecarUrl?: string
  fullText: string
  spokenSoFar: string
}) {
  return postJson<VoiceContinuationChunk>(sidecarBase(input.sidecarUrl), "/voice/continuation-chunk", {
    fullText: input.fullText,
    spokenSoFar: input.spokenSoFar,
  })
}
