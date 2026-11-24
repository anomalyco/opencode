// Soundtracks for share videos: 90s East Coast boom-bap rap songs with our own lyrics, for the kinds of data on the
// page: seven of the originals (two explicit), then seven explicit ones. ElevenLabs Music v2.5, one take each with custom
// lyrics, on one grid: 96 BPM, a bar is 2.5 s, a spoken line over the filtered intro (bars 1 and 2), a 4-bar verse from
// 5 s, a 2-bar hook from 15 s, then the drop at about 20 s into a heavier beat for the closing slides. Cut 6.25 s after
// the drop with a short fade and loudness-matched to -14 LUFS. public/share-music has the files.

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

// The originals first, remade with the drop and ending in the same take; then the explicit set.
export const shareTracks: ShareTrack[] = [
  { id: "market", name: "Hold the Block", mood: "Piano stabs and baritone sax", beat: 0.239 },
  { id: "models", name: "Rank and File", mood: "Tremolo guitar and horns", beat: 0.139 },
  { id: "cache", name: "Cache Hit", mood: "Cold piano and organ", beat: 0.129 },
  { id: "newblood", name: "New Blood", mood: "Soul vocal and horn stab", beat: 0.015 },
  { id: "cheapshot", name: "Cheap Shot", mood: "Warped Rhodes and bowed bass", beat: 1.16 },
  { id: "burn", name: "Burn Through", mood: "Distorted organ and fuzz bass", explicit: true, beat: 0.029 },
  { id: "worldwide", name: "Worldwide", mood: "Warped strings and sub bass", explicit: true, beat: 0.364 },
  { id: "run-the-board", name: "Run the Board", mood: "Piano stabs and baritone sax", explicit: true, beat: 0.159 },
  { id: "top-ten", name: "Top Ten", mood: "Tremolo guitar and horn stabs", explicit: true, beat: 0 },
  { id: "clock-in", name: "Clock In", mood: "Vibraphone and muted trumpet", explicit: true, beat: 0.079 },
  { id: "day-one", name: "Day One", mood: "Soul vocal chop and horns", explicit: true, beat: 0.015 },
  { id: "half-price", name: "Half Price", mood: "Warped Rhodes and bowed bass", explicit: true, beat: 0.029 },
  { id: "trillions", name: "Trillions", mood: "Distorted organ and fuzz bass", explicit: true, beat: 0.104 },
  { id: "every-time-zone", name: "Every Time Zone", mood: "Warped strings and sub bass", explicit: true, beat: 0.124 },
].map((track) => ({
  explicit: false,
  ...track,
  bpm: 96,
  bar: 2.5,
  verse: 5,
  // The drop: the strong beat nearest the end of the song's hook (20 s), where the card cuts to its closing slides and
  // the track's ending comes in.
  length: track.beat + Math.round((20 - track.beat) / 1.25) * 1.25,
  url: `${import.meta.env.BASE_URL}share-music/${track.id}.mp3`,
  cover: `${import.meta.env.BASE_URL}share-music/${track.id}.jpg`,
}))
