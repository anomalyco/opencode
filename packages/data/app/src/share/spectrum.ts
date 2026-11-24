// The levels of a soundtrack, for the share card's dot equaliser: the track's spectrum at 30 frames a second in
// `bands` log-spaced bands from bass to treble, each scaled 0 to 1 against its own loudest moment. Decoded and
// measured once per track in the browser, so the preview and the exported video draw the same frames.

export type Spectrum = { fps: number; bands: number; frames: Float32Array[] }

const fps = 30
const bands = 48
const size = 2048
const cache = new Map<string, Promise<Spectrum>>()

export function loadSpectrum(url: string) {
  const known = cache.get(url)
  if (known) return known
  const next = measure(url)
  cache.set(url, next)
  return next
}

/** The level of the band under `column` of `columns` at `time` seconds, 0 to 1. */
export function spectrumLevel(spectrum: Spectrum, time: number, column: number, columns: number) {
  const frame = spectrum.frames[Math.min(spectrum.frames.length - 1, Math.max(0, Math.floor(time * spectrum.fps)))]
  return frame?.[Math.min(spectrum.bands - 1, Math.floor((column / columns) * spectrum.bands))] ?? 0
}

async function measure(url: string): Promise<Spectrum> {
  const context = new OfflineAudioContext(1, 1, 44100)
  const audio = await context.decodeAudioData(await (await fetch(url)).arrayBuffer())
  const samples = mono(audio)
  const rate = audio.sampleRate
  const edges = Array.from({ length: bands + 1 }, (_, index) => 45 * (14000 / 45) ** (index / bands))
  const window = Float32Array.from({ length: size }, (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size))
  const raw = Array.from({ length: Math.floor((samples.length / rate) * fps) }, (_, frame) => {
    const start = Math.floor((frame / fps) * rate) - size / 2
    const real = Float32Array.from({ length: size }, (_, index) => (samples[start + index] ?? 0) * (window[index] ?? 0))
    const magnitudes = fft(real)
    return Float32Array.from({ length: bands }, (_, band) => {
      const from = Math.max(1, Math.floor(((edges[band] ?? 0) * size) / rate))
      const to = Math.max(from + 1, Math.ceil(((edges[band + 1] ?? 0) * size) / rate))
      const energy = magnitudes.slice(from, to).reduce((sum, value) => sum + value, 0) / (to - from)
      return Math.log10(1 + energy * 40)
    })
  })
  // Each band against its own loudest moment, so the treble moves as much as the bass; then a quick rise and a
  // slower fall, like a meter's needle.
  const peaks = Array.from({ length: bands }, (_, band) => Math.max(1e-6, ...raw.map((frame) => frame[band] ?? 0)))
  const frames = raw.reduce<Float32Array[]>((result, frame) => {
    const last = result.at(-1)
    result.push(
      Float32Array.from(frame, (value, band) => {
        const level = Math.max(0, (value / (peaks[band] ?? 1) - 0.15) / 0.85) ** 0.9
        return Math.max(level, (last?.[band] ?? 0) * 0.82)
      }),
    )
    return result
  }, [])
  return { fps, bands, frames }
}

function mono(audio: AudioBuffer) {
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index))
  return Float32Array.from(
    { length: audio.length },
    (_, index) => channels.reduce((sum, channel) => sum + (channel[index] ?? 0), 0) / channels.length,
  )
}

// An in-place radix-2 FFT of a real signal; returns the magnitudes of the first half.
function fft(input: Float32Array) {
  const n = input.length
  const re = Float64Array.from(input)
  const im = new Float64Array(n)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0]
      ;[im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0]
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    for (let i = 0; i < n; i += length) {
      for (let k = 0; k < length / 2; k++) {
        const wr = Math.cos(angle * k)
        const wi = Math.sin(angle * k)
        const a = i + k
        const b = a + length / 2
        const tr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi
        const ti = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr
        re[b] = (re[a] ?? 0) - tr
        im[b] = (im[a] ?? 0) - ti
        re[a] = (re[a] ?? 0) + tr
        im[a] = (im[a] ?? 0) + ti
      }
    }
  }
  return Float32Array.from({ length: n / 2 }, (_, index) => Math.hypot(re[index] ?? 0, im[index] ?? 0) / n)
}
