// GPT-Live's built-in voices and how the regional ones speak, from the iOS app's CallVoice (openai-node
// `LiveAPI.BuiltInVoice`). The voice is fixed when a call starts, so a change applies to the next call.
export const voices = [
  { id: "alloy" },
  { id: "ash" },
  { id: "ballad" },
  { id: "beacon", accent: "filipino" },
  { id: "bossa", accent: "brazilian" },
  { id: "cedar" },
  { id: "cinder", accent: "southern" },
  { id: "coral" },
  { id: "delta", accent: "southern" },
  { id: "echo" },
  { id: "gleam", accent: "american" },
  { id: "marin" },
  { id: "meridian", accent: "american" },
  { id: "quartz", accent: "australian" },
  { id: "ripple", accent: "australian" },
  { id: "sage" },
  { id: "shimmer" },
  { id: "stone", accent: "irish" },
  { id: "tempo", accent: "brazilian" },
  { id: "verse" },
  { id: "vesper", accent: "british" },
  { id: "willow", accent: "irish" },
] as const

export type CallVoice = (typeof voices)[number]

export const defaultVoice = "marin"

/** The saved voice, or the default when it isn't one GPT-Live offers (an older or hand-edited setting). */
export function callVoice(saved: string) {
  return voices.find((voice) => voice.id === saved)?.id ?? defaultVoice
}
