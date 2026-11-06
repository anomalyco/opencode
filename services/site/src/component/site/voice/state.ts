import { createSignal } from "solid-js"

// Voice mode's shared state, loaded with every page.
//
// "closed": the orb rests in the bottom-right corner.
// "asking": the browser is asking for the microphone.
// "active": voice mode is on (listening, thinking, speaking or paused).
export type VoicePhase = "closed" | "asking" | "active"

// Kept for the visit, so a full page load comes back closed or paused (an active session returns
// paused, waiting for a click; nothing listens or asks for the microphone on its own).
export const voiceSessionKey = "opencode-voice-session"
const restored = typeof sessionStorage !== "undefined" && sessionStorage.getItem(voiceSessionKey) === "paused"

export const [voicePhase, setVoicePhase] = createSignal<VoicePhase>(restored ? "active" : "closed")

/** The live voice level, 0–1 (the microphone, or the assistant while it speaks), written every frame. */
export const voiceLevel = { value: 0 }
