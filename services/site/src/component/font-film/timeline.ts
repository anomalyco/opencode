/**
 * The edit of "OpenCode. Six letters.", the film on /font. Every cue comes from the narration,
 * David's takes cut into one file per line: each line's length and the onsets of its phrases
 * (`beats`, seconds from the line's start), measured by font-film/segment.ts. Lines have ids, so
 * scenes and the mixer find their cues by name. To re-time the film for a new take, paste the new
 * numbers here; gaps stretch toward TARGET (never below MIN_GAP), and every shot, caption and sound
 * cue follows.
 */
export const fps = 30

const script = [
  { id: "square", text: "In the beginning… there was a square.", length: 2.63, beats: [] },
  { id: "units", text: "One hundred and twenty units. No more. No less.", length: 4.09, beats: [2.24, 3.27], gap: 1.5 },
  { id: "grid", text: "The logo demanded letters that obey the grid. Absolutely.", length: 3.93, beats: [3] },
  {
    id: "terminal",
    text: "It was born in the terminal. One module: half a character cell. One letter: four cells wide. If it doesn’t render in a terminal… it doesn’t exist.",
    length: 10.92,
    beats: [2.33, 5.15, 7.52, 9.7],
    gap: 1.5,
  },
  { id: "six", text: "So we did not draw twenty-six letters. We drew six.", length: 3.69, beats: [2.63] },
  { id: "letters", text: "O. P. E. N. C. D.", length: 3.72, beats: [0.75, 1.5, 2.17, 2.71, 3.4] },
  {
    id: "wordmark",
    text: "The wordmark only ever needed six. Every other letter… was a compromise.",
    length: 5.03,
    beats: [2.66, 4.01],
    gap: 2.5,
  },
  { id: "curves", text: "No curves. Curves are indecision.", length: 2.79, beats: [1.24] },
  { id: "diagonals", text: "No diagonals. No shortcuts.", length: 2.27, beats: [1.25] },
  { id: "edges", text: "Every edge on the grid. Every corner on a whole module.", length: 3.74, beats: [1.79] },
  {
    id: "measure",
    text: "Symmetry: measured. Ink coverage: counted. The shade: calibrated to the module.",
    length: 5.83,
    beats: [0.49, 1.79, 2.27, 3.63, 4.08],
  },
  { id: "half", text: "The o carries fourteen modules of ink. Exactly half.", length: 3.65, beats: [2.7] },
  { id: "kerning", text: "Thirty-six kerning pairs. Every value… zero.", length: 3.66, beats: [1.96, 3.08] },
  {
    id: "cared",
    text: "Not because we didn’t care. Because we cared… completely.",
    length: 3.52,
    beats: [1.71, 2.82],
    gap: 1.5,
  },
  { id: "bytes", text: "Forty-nine kilobytes. Not one byte of decoration.", length: 3.66, beats: [1.8] },
  {
    id: "thousands",
    text: "Some typefaces have thousands of glyphs. This one has the only six that matter.",
    length: 4.95,
    beats: [2.69],
    gap: 2.5,
  },
  {
    id: "combinations",
    text: "Only six letters. Yet every visit maps the other 3,591 characters afresh. A number of combinations 2,795 digits long.",
    length: 12.01,
    beats: [1.78, 7.38, 10.91],
    gap: 2,
  },
  { id: "yours", text: "Download it… and the typeface is yours alone.", length: 3.14, beats: [1.13, 2.18] },
]

export type CueID = (typeof script)[number]["id"]

const LEAD = 0.6
const TAIL = 2.4
const MIN_GAP = 0.18
const TARGET = 60

const spoken = script.reduce((sum, line) => sum + line.length, 0)
const weights = script.slice(0, -1).map((line) => line.gap ?? 1)
const unit = Math.max(MIN_GAP, (TARGET - LEAD - TAIL - spoken) / weights.reduce((sum, weight) => sum + weight, 0))

/** Each narration line placed on the film's clock, with its phrase onsets as absolute times. */
export const cues = script.reduce<{ id: CueID; text: string; start: number; end: number; beats: number[] }[]>(
  (list, line, index) => {
    const start = index === 0 ? LEAD : list[index - 1].end + unit * weights[index - 1]
    return [
      ...list,
      {
        id: line.id,
        text: line.text,
        start,
        end: start + line.length,
        beats: [start, ...line.beats.map((beat) => start + beat)],
      },
    ]
  },
  [],
)

/** A cue by id. */
export const cue = (id: CueID) => cues.find((item) => item.id === id)!

export const duration = Math.ceil(Math.max(TARGET, cues[cues.length - 1].end + TAIL) * fps) / fps

/** Cuts land a few frames before the voice, the way an editor cuts on the breath. */
const PRE = 0.12

const plan = [
  { id: "module", cue: "square", label: "One module" },
  { id: "grid", cue: "grid", label: "The grid" },
  { id: "terminal", cue: "terminal", label: "Born in the terminal" },
  { id: "alphabet", cue: "six", label: "Twenty-six, minus twenty" },
  { id: "letters", cue: "letters", label: "O. P. E. N. C. D." },
  { id: "parade", cue: "wordmark", label: "The wordmark" },
  { id: "compromise", cue: "wordmark", beat: 1, label: "Compromise" },
  { id: "curves", cue: "curves", label: "No curves, no diagonals" },
  { id: "plotter", cue: "edges", label: "Pen plotter, outline of e" },
  { id: "measure", cue: "measure", label: "Symmetry, ink, shade" },
  { id: "loupe", cue: "half", label: "Loupe, the o" },
  { id: "kerning", cue: "kerning", label: "Kerning table" },
  { id: "exploded", cue: "cared", label: "Exploded view" },
  { id: "bytes", cue: "bytes", label: "49,208 bytes" },
  { id: "thousands", cue: "thousands", label: "The only six" },
  { id: "variants", cue: "combinations", label: "6^3,591" },
  { id: "yours", cue: "yours", label: "Yours" },
] as const satisfies readonly { id: string; cue: CueID; beat?: number; label: string }[]

export const shots = plan.map((shot, index) => {
  const at = (item: (typeof plan)[number]) => {
    const beat = "beat" in item ? Number(item.beat) : 0
    return item.cue === "square" && beat === 0 ? 0 : cue(item.cue).beats[beat] - PRE
  }
  const next = plan[index + 1]
  return { id: shot.id, label: shot.label, start: at(shot), end: next ? at(next) : duration }
})

export type ShotID = (typeof shots)[number]["id"]

export function shotAt(time: number) {
  return shots.find((shot) => time < shot.end) ?? shots[shots.length - 1]
}

/** The narration as WebVTT, from the same cues. */
export function captions() {
  const stamp = (value: number) => {
    const ms = Math.round(value * 1000)
    const pad = (n: number, l = 2) => String(n).padStart(l, "0")
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`
  }
  return [
    "WEBVTT",
    "",
    ...cues.flatMap((cue, index) => [
      String(index + 1),
      `${stamp(cue.start)} --> ${stamp(Math.min(cue.end + 0.25, cues[index + 1]?.start ?? duration))}`,
      cue.text,
      "",
    ]),
  ].join("\n")
}
