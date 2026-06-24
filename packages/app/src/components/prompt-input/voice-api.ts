import { voiceSidecarBaseUrl } from "./voice-sidecar"

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
}

export type VoiceContinuationChunk = {
  chunk: string
  done: boolean
  offer?: string
}

function sidecarBase(sidecarUrl?: () => string) {
  return (sidecarUrl?.() ?? voiceSidecarBaseUrl()).replace(/\/+$/, "")
}

async function postJson<T>(base: string, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `voice request failed (${res.status})`
    throw new Error(message)
  }
  return data as T
}

export async function fetchVoiceAck(input?: {
  sidecarUrl?: () => string
  text?: string
  progress?: VoiceProgressSnapshot
}) {
  return postJson<VoiceAckResult>(sidecarBase(input?.sidecarUrl), "/voice/ack", {
    text: input?.text ?? "",
    progress: input?.progress,
  })
}

export async function fetchVoiceDecide(input: {
  sidecarUrl?: () => string
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

export async function fetchVoiceFinalSpeak(input: { sidecarUrl?: () => string; text: string }) {
  return postJson<VoiceFinalSpeakPlan>(sidecarBase(input.sidecarUrl), "/voice/final-speak", {
    text: input.text,
  })
}

export async function fetchVoiceContinuationChunk(input: {
  sidecarUrl?: () => string
  fullText: string
  spokenSoFar: string
}) {
  return postJson<VoiceContinuationChunk>(sidecarBase(input.sidecarUrl), "/voice/continuation-chunk", {
    fullText: input.fullText,
    spokenSoFar: input.spokenSoFar,
  })
}
