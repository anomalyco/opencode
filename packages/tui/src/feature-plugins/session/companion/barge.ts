const PREROLL_MS = 400
const ONSET_MS = 150
const END_MS = 700
const MAX_MS = 15_000
// Raw RMS (about -46 dBFS) below which nothing counts as speech, even in a silent room.
const MIN_LEVEL = 0.005
const FLOOR_RATIO = 3
const ECHO_MARGIN = 2
const MIN_PLAYBACK = 0.005

export type Utterance = { readonly samples: Float32Array; readonly sampleRate: number }

/**
 * Detects the user talking over playback. The microphone also hears the
 * speakers, so a chunk counts as speech only when it is louder than the
 * noise floor and louder than `coupling` times the recent playback level
 * would explain. `coupling` follows the echo it hears between words and
 * rises when a detected utterance turns out to be echo (`rejected`).
 */
export function createBargeDetector(input: {
  readonly onOnset: () => void
  readonly onUtterance: (utterance: Utterance) => void
}) {
  let coupling = 0.5
  let floor = MIN_LEVEL
  let preroll: { samples: Float32Array; ms: number }[] = []
  let prerollMs = 0
  let run = { ms: 0, ratio: 0 }
  let onsetRatio = 0
  let speech: { chunks: Float32Array[]; sampleRate: number; ms: number; silence: number } | undefined

  const finish = () => {
    if (!speech) return
    const utterance = { samples: concat(speech.chunks), sampleRate: speech.sampleRate }
    speech = undefined
    input.onUtterance(utterance)
  }

  return {
    /** Feeds one microphone chunk with the loudest playback level of the last few hundred milliseconds. */
    push(samples: Float32Array, sampleRate: number, playback: number) {
      const ms = (samples.length / sampleRate) * 1000
      const mic = energy(samples)
      floor = Math.min(Math.max(mic, 1e-4), floor * 1.002)
      const ratio = playback > MIN_PLAYBACK ? mic / playback : 0
      const loud = mic > Math.max(MIN_LEVEL, floor * FLOOR_RATIO) && mic > coupling * playback * ECHO_MARGIN

      if (speech) {
        speech.chunks.push(samples)
        speech.ms += ms
        speech.silence = loud ? 0 : speech.silence + ms
        if (speech.silence >= END_MS || speech.ms >= MAX_MS) finish()
        return
      }

      preroll.push({ samples, ms })
      prerollMs += ms
      while (preroll.length > 1 && prerollMs - (preroll[0]?.ms ?? 0) >= PREROLL_MS)
        prerollMs -= preroll.shift()?.ms ?? 0
      if (!loud) {
        run = { ms: 0, ratio: 0 }
        // Follow the echo slowly in both directions, so real speech above it stays detectable.
        if (ratio > 0) coupling = ratio > coupling ? Math.min(ratio, coupling * 1.01) : Math.max(0.05, coupling * 0.999)
        return
      }
      run = { ms: run.ms + ms, ratio: Math.max(run.ratio, ratio) }
      if (run.ms < ONSET_MS) return
      onsetRatio = run.ratio
      speech = { chunks: preroll.map((chunk) => chunk.samples), sampleRate, ms: prerollMs, silence: 0 }
      preroll = []
      prerollMs = 0
      run = { ms: 0, ratio: 0 }
      input.onOnset()
    },
    /** Ends the current utterance now. */
    flush: finish,
    /** Marks the last utterance as the speakers' own echo, so the same level no longer counts as speech. */
    rejected() {
      coupling = Math.min(4, Math.max(coupling, onsetRatio * 0.75))
    },
    /** Drops buffered audio; the learned echo level and noise floor stay. */
    reset() {
      preroll = []
      prerollMs = 0
      run = { ms: 0, ratio: 0 }
      speech = undefined
    },
    get active() {
      return speech !== undefined
    },
  }
}

export type BargeDetector = ReturnType<typeof createBargeDetector>

/** Whether a transcript mostly repeats what the speakers just said. */
export function echoes(transcript: string, spoken: string) {
  const heard = words(transcript)
  const said = new Set(words(spoken))
  return heard.length > 0 && heard.filter((word) => said.has(word)).length / heard.length >= 0.6
}

function words(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
}

/** Root-mean-square amplitude. */
export function energy(samples: Float32Array) {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

export function concat(chunks: Float32Array[]) {
  const result = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  chunks.reduce((offset, chunk) => {
    result.set(chunk, offset)
    return offset + chunk.length
  }, 0)
  return result
}
