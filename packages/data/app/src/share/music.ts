// Soundtracks for share videos: 15-second instrumental boom-bap loops, one for each kind of data on the page,
// generated with ElevenLabs Music v2.5 (through FLORA) and loudness-matched to -16 LUFS. public/share-music has the files.

export type ShareTrack = { id: string; name: string; mood: string; bpm: number; url: string }

export const shareTracks: ShareTrack[] = [
  { id: "tokens", name: "Token Count", mood: "Rhodes and upright bass", bpm: 92 },
  { id: "market", name: "Share of Voice", mood: "Dark piano, hard drums", bpm: 90 },
  { id: "models", name: "Model Run", mood: "Soul horns, synth bass", bpm: 88 },
  { id: "usage", name: "Daily Active", mood: "Vibraphone and scratches", bpm: 94 },
  { id: "cache", name: "Cache Hit", mood: "Minimal, sine bleeps", bpm: 86 },
].map((track) => ({ ...track, url: `${import.meta.env.BASE_URL}share-music/${track.id}.mp3` }))

// The track that fits each section best, marked in the picker.
export const suggestedTrack: Record<string, string> = {
  "top-models": "tokens",
  "unique-users": "usage",
  retention: "models",
  "session-cost": "cache",
  "token-cost": "cache",
  "cache-ratio": "cache",
  "market-share": "market",
  "geo-breakdown": "market",
}
