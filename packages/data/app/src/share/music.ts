// Soundtracks for share videos: explicit 90s East Coast boom-bap rap songs with our own lyrics, one for each kind of data
// on the page. ElevenLabs Music v2.5, one take each with custom lyrics, on one grid: 96 BPM, a bar is 2.5 s, a spoken
// line over the filtered intro (bars 1 and 2), a 4-bar verse from 5 s, a 2-bar hook from 15 s, then the drop at about
// 20 s into a heavier beat for the closing slides. Cut 6.25 s after the drop with a short fade and loudness-matched to
// -14 LUFS. public/share-music has the files.

// `bar` and `verse` are seconds (one bar, and where the verse and the full beat start); `length` is where the track stops.
export type ShareTrack = {
  id: string
  name: string
  mood: string
  bpm: number
  explicit: boolean
  bar: number
  // Where a strong beat (1 or 3) falls in the file, in seconds, measured from its kick drum; the cuts land on these.
  beat: number
  verse: number
  length: number
  url: string
  cover: string
}

export const shareTracks: ShareTrack[] = [
  { id: "market", name: "Run the Board", mood: "Piano stabs and baritone sax", beat: 0.159 },
  { id: "models", name: "Top Ten", mood: "Tremolo guitar and horn stabs", beat: 0.01 },
  { id: "usage", name: "Clock In", mood: "Vibraphone and muted trumpet", beat: 0.079 },
  { id: "cache", name: "Paid Once", mood: "Cold piano and organ", beat: 0.079 },
  { id: "newblood", name: "Day One", mood: "Soul vocal chop and horns", beat: 0.015 },
  { id: "cheapshot", name: "Half Price", mood: "Warped Rhodes and bowed bass", beat: 0.029 },
  { id: "burn", name: "Trillions", mood: "Distorted organ and fuzz bass", beat: 0.104 },
  { id: "worldwide", name: "Every Time Zone", mood: "Warped strings and sub bass", beat: 0.124 },
].map((track) => ({
  ...track,
  explicit: true,
  bpm: 96,
  bar: 2.5,
  verse: 5,
  // The drop: the strong beat nearest the end of the song's hook (20 s), where the card cuts to its closing slides and
  // the track's ending comes in.
  length: track.beat + Math.round((20 - track.beat) / 1.25) * 1.25,
  url: `${import.meta.env.BASE_URL}share-music/${track.id}.mp3`,
  cover: `${import.meta.env.BASE_URL}share-music/${track.id}.jpg`,
}))
