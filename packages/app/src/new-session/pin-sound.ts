// Synthesised stone sounds for the new session pin board. Nothing is loaded from disk; every sound is a
// short burst of filtered noise, optionally with a low thud, so the whole palette reads as pebbles on stone.

const PENTATONIC = [0, 2, 4, 7, 9]

type Audio = { context: AudioContext; bus: GainNode; noise: AudioBuffer; recent: number[] }

let shared: Audio | undefined

/** Returns a running audio graph, or nothing when the browser would block or has not been interacted with. */
function audio() {
  if (typeof AudioContext === "undefined" || document.hidden) return
  if (!navigator.userActivation?.hasBeenActive) return
  if (!shared) shared = createAudio()
  if (shared.context.state === "suspended") void shared.context.resume()
  if (shared.context.state !== "running") return
  return shared
}

function createAudio(): Audio {
  const context = new AudioContext()
  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = -24
  limiter.ratio.value = 4
  limiter.connect(context.destination)
  const master = context.createGain()
  master.gain.value = 0.9
  master.connect(limiter)
  const bus = context.createGain()
  bus.connect(master)
  const room = context.createConvolver()
  room.buffer = impulse(context, 1.2, 3.2)
  const wet = context.createGain()
  wet.gain.value = 0.18
  bus.connect(room)
  room.connect(wet)
  wet.connect(master)
  const noise = context.createBuffer(1, context.sampleRate, context.sampleRate)
  noise.getChannelData(0).forEach((_, i, data) => (data[i] = Math.random() * 2 - 1))
  return { context, bus, noise, recent: [] }
}

function impulse(context: AudioContext, seconds: number, decay: number) {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
  }
  return buffer
}

// Caps bursts of collision sounds so a crumble stays a patter rather than a roar.
function allow(a: Audio) {
  const now = performance.now()
  while (a.recent.length && now - a.recent[0] > 80) a.recent.shift()
  if (a.recent.length >= 5) return false
  a.recent.push(now)
  return true
}

/** One pebble click: band-passed noise with a resonant body and an optional low thud. */
function pebble(
  a: Audio,
  at: number,
  input: { freq: number; q: number; gain: number; decay: number; pan: number; thud?: number },
) {
  const c = a.context
  const source = c.createBufferSource()
  source.buffer = a.noise
  const band = c.createBiquadFilter()
  band.type = "bandpass"
  band.frequency.value = input.freq
  band.Q.value = input.q
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, at)
  env.gain.exponentialRampToValueAtTime(input.gain, at + 0.002)
  env.gain.exponentialRampToValueAtTime(0.0001, at + input.decay)
  const pan = c.createStereoPanner()
  pan.pan.value = Math.max(-0.9, Math.min(0.9, input.pan))
  source.connect(band).connect(env).connect(pan).connect(a.bus)
  source.start(at, Math.random() * 0.8, input.decay + 0.02)
  if (!input.thud) return
  const body = c.createOscillator()
  body.frequency.setValueAtTime(input.thud * 1.6, at)
  body.frequency.exponentialRampToValueAtTime(input.thud, at + 0.03)
  const thud = c.createGain()
  thud.gain.setValueAtTime(0.0001, at)
  thud.gain.exponentialRampToValueAtTime(input.gain * 0.5, at + 0.003)
  thud.gain.exponentialRampToValueAtTime(0.0001, at + input.decay * 2.5)
  body.connect(thud).connect(pan)
  body.start(at)
  body.stop(at + input.decay * 2.5 + 0.02)
}

const note = (step: number) =>
  440 * Math.pow(2, (74 + 12 * Math.floor(step / 5) + PENTATONIC[((step % 5) + 5) % 5] - 69) / 12)
const panOf = (x: number, width: number) => (width ? (x / width) * 1.6 - 0.8 : 0)

export const PinSound = {
  /** The wordmark rising in: a gritty stone slide sweeping across with pebbles settling under it. */
  sweep(input: { duration: number; columns: number; reverse?: boolean }) {
    const a = audio()
    if (!a) return
    const c = a.context
    const at = c.currentTime + 0.02
    const end = at + input.duration

    const source = c.createBufferSource()
    source.buffer = a.noise
    source.loop = true
    const grit = c.createBiquadFilter()
    grit.type = "bandpass"
    grit.Q.value = 1.4
    grit.frequency.setValueAtTime(input.reverse ? 1500 : 260, at)
    grit.frequency.exponentialRampToValueAtTime(input.reverse ? 260 : 1500, end)
    const body = c.createBiquadFilter()
    body.type = "lowpass"
    body.frequency.value = 2400
    const env = c.createGain()
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(0.03, at + 0.12)
    env.gain.setValueAtTime(0.03, end - 0.18)
    env.gain.exponentialRampToValueAtTime(0.0001, end + 0.12)
    const pan = c.createStereoPanner()
    pan.pan.setValueAtTime(-0.7, at)
    pan.pan.linearRampToValueAtTime(0.7, end)
    source.connect(grit).connect(body).connect(env).connect(pan).connect(a.bus)
    source.start(at)
    source.stop(end + 0.15)

    const clicks = 22
    for (let i = 0; i < clicks; i++) {
      const k = (i + Math.random() * 0.6) / clicks
      pebble(a, at + k * (input.duration - 0.1) + 0.06, {
        freq: 1800 + Math.random() * 1600,
        q: 5,
        gain: 0.02 + Math.random() * 0.018,
        decay: 0.02 + Math.random() * 0.015,
        pan: k * 1.4 - 0.7,
      })
    }
  },

  /** A click that knocks pins out: one solid stone clack. */
  knock(x: number, width: number) {
    const a = audio()
    if (!a) return
    pebble(a, a.context.currentTime, { freq: 1100, q: 2.2, gain: 0.14, decay: 0.05, pan: panOf(x, width), thud: 95 })
  },

  /** The brick breaker ball smashing pins: a clack whose ring climbs the scale with each hit before the paddle. */
  brick(x: number, width: number, combo: number) {
    const a = audio()
    if (!a) return
    const at = a.context.currentTime
    pebble(a, at, { freq: 1300, q: 2, gain: 0.1, decay: 0.04, pan: panOf(x, width), thud: 110 })
    pebble(a, at + 0.004, { freq: note(Math.min(14, combo)), q: 16, gain: 0.06, decay: 0.09, pan: panOf(x, width) })
  },

  /** The brick breaker ball landing on the paddle: a soft, low knock. */
  paddle(x: number, width: number) {
    const a = audio()
    if (!a) return
    pebble(a, a.context.currentTime, { freq: 520, q: 1.4, gain: 0.12, decay: 0.05, pan: panOf(x, width), thud: 72 })
  },

  /** A loose pin bouncing off the composer or the floor. */
  bounce(x: number, width: number, speed: number) {
    const a = audio()
    if (!a || !allow(a)) return
    pebble(a, a.context.currentTime, {
      freq: 2200 + Math.random() * 1400,
      q: 6,
      gain: Math.min(0.07, 0.012 + speed / 40000),
      decay: 0.02,
      pan: panOf(x, width),
    })
  },

  /** A pin seating back into its socket; pitch rises across the wordmark so the return reads as a cascade. */
  slot(column: number, columns: number, x: number, width: number) {
    const a = audio()
    if (!a || !allow(a)) return
    pebble(a, a.context.currentTime, {
      freq: note(Math.floor((column / columns) * 10)),
      q: 14,
      gain: 0.05,
      decay: 0.045,
      pan: panOf(x, width),
    })
  },
}
