import { voiceSidecarBaseUrl } from "./play"

export type VoiceSidecarEvent =
  | { type: "ready"; voiceID: string; opencodeSessionID: string; sampleRate: number; encoding: string }
  | { type: "status"; state: string; text?: string; reason?: string; retry?: number }
  | { type: "transcript"; text: string; final: boolean; speechFinal: boolean }
  | { type: "reply"; text: string }
  | { type: "tts"; format: string; encoding: string; data: string }
  | { type: "speak"; skipped?: boolean }
  | { type: "error"; message: string }

export type VoiceSessionInfo = {
  id: string
  stream: string
}

export async function createVoiceSidecarSession(input: {
  sidecarUrl?: string
  directory: string
  sessionID?: string
  agent?: string
  server?: string
  terminalMic?: boolean
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
      composer: true,
      terminalMic: input.terminalMic ?? true,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `voice session failed (${res.status})`
    throw new Error(message)
  }
  return data as VoiceSessionInfo
}

function speechFinal(event: { speechFinal?: boolean; speech_final?: boolean }) {
  return event.speechFinal === true || event.speech_final === true
}

export function parseVoiceSidecarEvent(raw: string): VoiceSidecarEvent | undefined {
  try {
    const event = JSON.parse(raw) as VoiceSidecarEvent & { speech_final?: boolean }
    if (event.type === "transcript") {
      return {
        ...event,
        speechFinal: speechFinal(event),
      }
    }
    return event
  } catch {
    return undefined
  }
}
