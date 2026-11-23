// Soundtracks for share videos: 20-second 90s East Coast boom-bap rap songs with our own lyrics, for the kinds of data
// on the page. ElevenLabs Music v2.5, one take each with custom lyrics, on one grid: 96 BPM, a bar is 2.5 s, a
// spoken line over the filtered intro (bars 1 and 2), a 4-bar verse from 5 s, a 2-bar hook from 15 s, and the beat
// stops on the last word at 20 s. Cut to 20.0 s and loudness-matched to -14 LUFS. public/share-music has the files.

// `bar` and `verse` are seconds (one bar, and where the verse and the full beat start); `length` is where the track stops.
export type ShareTrack = {
  id: string
  name: string
  mood: string
  bpm: number
  explicit: boolean
  bar: number
  verse: number
  length: number
  url: string
}

export const shareTracks: ShareTrack[] = [
  { id: "market", name: "Hold the Block", mood: "Piano stabs and baritone sax" },
  { id: "models", name: "Rank and File", mood: "Tremolo guitar and horns" },
  { id: "usage", name: "Come Back", mood: "Vibraphone and muted trumpet" },
  { id: "cache", name: "Cache Hit", mood: "Cold piano and organ" },
].map((track) => ({
  ...track,
  bpm: 96,
  explicit: false,
  bar: 2.5,
  verse: 5,
  length: 20,
  url: `${import.meta.env.BASE_URL}share-music/${track.id}.mp3`,
}))
