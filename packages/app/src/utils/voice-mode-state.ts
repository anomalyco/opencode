export type VoiceModeState =
  | "idle"
  | "listening"
  | "recording"
  | "transcribing"
  | "waiting"
  | "speaking"

export type VoiceModeEvent =
  | { type: "toggle" }
  | { type: "speech_start" }
  | { type: "speech_end"; audio: Float32Array }
  | { type: "transcription_complete"; text: string }
  | { type: "transcription_failed"; error: string }
  | { type: "response_complete" }
  | { type: "tts_finished" }
  | { type: "error"; message: string }

export function transition(state: VoiceModeState, event: VoiceModeEvent): VoiceModeState {
  switch (state) {
    case "idle":
      if (event.type === "toggle") return "listening"
      return state
    case "listening":
      if (event.type === "toggle") return "idle"
      if (event.type === "speech_start") return "recording"
      return state
    case "recording":
      if (event.type === "toggle") return "idle"
      if (event.type === "speech_end") return "transcribing"
      return state
    case "transcribing":
      if (event.type === "toggle") return "idle"
      if (event.type === "transcription_complete") return "waiting"
      if (event.type === "transcription_failed") return "listening"
      if (event.type === "error") return "listening"
      return state
    case "waiting":
      if (event.type === "toggle") return "idle"
      if (event.type === "response_complete") return "speaking"
      if (event.type === "error") return "listening"
      return state
    case "speaking":
      if (event.type === "toggle") return "idle"
      if (event.type === "speech_start") return "recording" // barge-in
      if (event.type === "tts_finished") return "listening"
      if (event.type === "error") return "listening"
      return state
    default:
      return state
  }
}

/** Convert Float32Array PCM samples to a WAV Blob for upload */
export function float32ToWav(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeString(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: "audio/wav" })
}
