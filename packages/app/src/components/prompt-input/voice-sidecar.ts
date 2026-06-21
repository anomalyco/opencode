import { hostedVoiceSidecarUrl } from "@/utils/hosted-url"

export type VoiceSidecarStatus = "listening" | "transcribing" | "working" | "speaking" | "idle"

export type VoiceSidecarEvent =
  | { type: "ready"; voiceID: string; opencodeSessionID: string; sampleRate: number; encoding: string }
  | { type: "status"; state: VoiceSidecarStatus; text?: string; reason?: string; retry?: number }
  | { type: "transcript"; text: string; final: boolean; speechFinal: boolean }
  | { type: "reply"; text: string }
  | { type: "tts"; format: string; encoding: string; data: string }
  | { type: "error"; message: string }

export type VoiceSessionInfo = {
  id: string
  stream: string
  opencode: {
    url: string
    sessionID: string
    directory: string
    agent?: string
  }
}

export function voiceSidecarBaseUrl() {
  return hostedVoiceSidecarUrl()
}

export async function createVoiceSidecarSession(input: {
  sidecarUrl?: string
  directory: string
  sessionID?: string
  agent?: string
  server?: string
}): Promise<VoiceSessionInfo> {
  const base = (input.sidecarUrl ?? voiceSidecarBaseUrl()).replace(/\/+$/, "")
  const res = await fetch(`${base}/voice/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directory: input.directory,
      sessionID: input.sessionID,
      agent: input.agent,
      server: input.server,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `voice session failed (${res.status})`
    throw new Error(message)
  }
  return data as VoiceSessionInfo
}

export function parseVoiceSidecarEvent(raw: string): VoiceSidecarEvent | undefined {
  try {
    return JSON.parse(raw) as VoiceSidecarEvent
  } catch {
    return undefined
  }
}
