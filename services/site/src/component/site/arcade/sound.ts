import { createEffect, createSignal } from "solid-js"
import { siteSettings } from "../settings"
import { mediaUrl } from "~/lib/media"

/**
 * The arcade's sound. Recorded sounds come from /arcade404/audio/manifest.json; anything missing
 * there is synthesised with Web Audio. The ambience tries to start on arrival; browsers block that
 * until a gesture, so the first pointer or key press anywhere starts it. Mute persists.
 */

export type SoundName =
  | "ambience"
  | "coin-pickup"
  | "coin-insert"
  | "coin-reject"
  | "power-up"
  | "glitch"
  | "boot"
  | "start"
  | "menu-move"
  | "menu-select"
  | "power-off"

const muteKey = "opencode-arcade-muted"
const names: SoundName[] = [
  "ambience",
  "coin-pickup",
  "coin-insert",
  "coin-reject",
  "power-up",
  "glitch",
  "boot",
  "start",
  "menu-move",
  "menu-select",
  "power-off",
]
const [muted, setMutedSignal] = createSignal(false)
const [running, setRunning] = createSignal(false)
let context: AudioContext | undefined
let master: GainNode | undefined
// Sound effects (everything but the ambience), so Settings › Sound effects scales them together.
let effects: GainNode | undefined
let ambienceGain: GainNode | undefined
let ambienceSource: AudioBufferSourceNode | undefined
let ducked = false
const buffers = new Map<SoundName, AudioBuffer>()
const volumes = new Map<SoundName, number>()

/** True while sound is actually audible: not muted, and the browser let the context start. */
export const audible = () => running() && !muted()
export { muted }

/** Set up on mount: read the mute choice, try to start (autoplay), and fall back to the first gesture. */
export function startAudio() {
  setMutedSignal(localStorage.getItem(muteKey) === "1")
  context = new AudioContext()
  master = context.createGain()
  master.gain.value = level()
  master.connect(context.destination)
  effects = context.createGain()
  effects.gain.value = siteSettings.arcadeSfx / 100
  effects.connect(master)
  // Settings › 404 arcade volumes apply live.
  createEffect(() => {
    const volume = level()
    const ambience = ambienceLevel()
    const sfx = siteSettings.arcadeSfx / 100
    if (!context || !master || !effects) return
    master.gain.setTargetAtTime(volume, context.currentTime, 0.05)
    effects.gain.setTargetAtTime(sfx, context.currentTime, 0.05)
    if (ambienceGain && !ducked) ambienceGain.gain.setTargetAtTime(ambience, context.currentTime, 0.1)
  })
  context.onstatechange = () => {
    setRunning(context?.state === "running")
    if (context?.state === "running") startAmbience()
  }
  setRunning(context.state === "running")
  void load()
  const gesture = () => unlockAudio()
  for (const type of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(type, gesture, { capture: true })
  return () => {
    for (const type of ["pointerdown", "keydown", "touchstart"])
      window.removeEventListener(type, gesture, { capture: true })
    ambienceSource?.stop()
    void context?.close()
    context = undefined
  }
}

/** Inside a gesture: browsers allow the context to start now. */
export function unlockAudio() {
  if (context && context.state !== "running") void context.resume()
}

export function setMuted(value: boolean) {
  setMutedSignal(value)
  localStorage.setItem(muteKey, value ? "1" : "0")
}

// The overall level (mute and Settings › Volume) and the room tone's (its recording's own level
// scaled by Settings › Ambience).
const level = () => (muted() ? 0 : siteSettings.arcadeVolume / 100)
const ambienceLevel = () => (volumes.get("ambience") ?? 0.5) * (siteSettings.arcadeAmbience / 100)

/** Lower the room tone while a game plays its own sound. */
export function duckAmbience(value: boolean) {
  ducked = value
  if (!context || !ambienceGain) return
  ambienceGain.gain.setTargetAtTime(value ? 0 : ambienceLevel(), context.currentTime, 0.3)
}

async function load() {
  const manifest = await fetch("/arcade404/audio/manifest.json")
    .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
    .catch(() => undefined)
  await Promise.all(
    entries(manifest).map(async ([name, file, volume]) => {
      const data = await fetch(new URL(file, new URL("/arcade404/audio/", location.href)))
        .then((response) => (response.ok ? response.arrayBuffer() : undefined))
        .catch(() => undefined)
      if (!data || !context) return
      const buffer = await context.decodeAudioData(data).catch(() => undefined)
      if (!buffer) return
      buffers.set(name, buffer)
      if (volume !== undefined) volumes.set(name, volume)
    }),
  )
  startAmbience()
}

type Files = { webm?: string; mp3?: string }
type Manifest = {
  sounds?: Record<
    string,
    { files?: Files; volume?: number; variants?: { id: string; files?: Files; volume?: number }[] }
  >
}

/**
 * The chosen take where the manifest offers several (the user's picks): the token sliding across
 * the dusty floor and a light clink, and a 1980s PC power-on (switch, fan, drive, one beep, seeks).
 * Exported so every arcade version plays the same sounds.
 */
export const preferredVariant: Partial<Record<SoundName, string>> = {
  boot: "boot-post",
  "coin-pickup": "coin-pickup-slide",
}

// manifest.json: { sounds: { name: { files: { webm, mp3 }, volume, variants? } } }. Opus in WebM
// where the browser decodes it, MP3 elsewhere (Safari).
function entries(manifest: unknown): [SoundName, string, number | undefined][] {
  const opus = new Audio().canPlayType('audio/webm; codecs="opus"') === "probably"
  return Object.entries((manifest as Manifest | undefined)?.sounds ?? {}).flatMap(([name, sound]) => {
    if (!names.includes(name as SoundName)) return []
    const variant = sound.variants?.find((item) => item.id === preferredVariant[name as SoundName])
    const files = variant?.files ?? sound.files
    const file = (opus ? files?.webm : undefined) ?? files?.mp3 ?? files?.webm
    if (!file) return []
    return [
      [name as SoundName, mediaUrl(file), variant?.volume ?? sound.volume] as [SoundName, string, number | undefined],
    ]
  })
}

function startAmbience() {
  if (!context || !master || ambienceSource || context.state !== "running") return
  ambienceGain = context.createGain()
  ambienceGain.gain.value = 0
  ambienceGain.connect(master)
  const buffer = buffers.get("ambience")
  if (buffer) {
    ambienceSource = context.createBufferSource()
    ambienceSource.buffer = buffer
    ambienceSource.loop = true
    ambienceSource.connect(ambienceGain)
    ambienceSource.start()
  } else {
    // A synthesised room tone: a low hum and filtered noise, until (or unless) the recording loads.
    ambienceSource = noiseSource(context, 2)
    ambienceSource.loop = true
    const low = context.createBiquadFilter()
    low.type = "lowpass"
    low.frequency.value = 380
    const hum = context.createOscillator()
    hum.frequency.value = 60
    const humGain = context.createGain()
    humGain.gain.value = 0.05
    hum.connect(humGain).connect(ambienceGain)
    hum.start()
    ambienceSource.connect(low).connect(ambienceGain)
    ambienceSource.start()
    ambienceSource.onended = () => hum.stop()
    // Swap to the recording when it arrives.
    const swap = setInterval(() => {
      if (!buffers.has("ambience") || !context) return
      clearInterval(swap)
      ambienceSource?.stop()
      ambienceSource = undefined
      startAmbience()
    }, 1000)
  }
  if (!ducked) ambienceGain.gain.setTargetAtTime(ambienceLevel(), context.currentTime, 0.8)
}

/** Play a sound by name: the recording if it loaded, otherwise a synthesised stand-in. */
export function play(name: Exclude<SoundName, "ambience">, delay = 0) {
  if (!context || !effects || context.state !== "running") return
  const at = context.currentTime + delay
  const buffer = buffers.get(name)
  if (buffer) {
    const source = context.createBufferSource()
    source.buffer = buffer
    const gain = context.createGain()
    gain.gain.value = volumes.get(name) ?? 0.8
    source.connect(gain).connect(effects)
    source.start(at)
    return
  }
  synth[name](context, effects, at)
}

// ——— Synthesised stand-ins ———

function noiseSource(ctx: AudioContext, seconds: number) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const source = ctx.createBufferSource()
  source.buffer = buffer
  return source
}

function envelope(ctx: AudioContext, out: AudioNode, at: number, peak: number, attack: number, decay: number) {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
  gain.connect(out)
  return gain
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  frequency: number,
  at: number,
  peak: number,
  decay: number,
) {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, at)
  osc.connect(envelope(ctx, out, at, peak, 0.004, decay))
  osc.start(at)
  osc.stop(at + decay + 0.05)
  return osc
}

function clicks(ctx: AudioContext, out: AudioNode, at: number, count: number, spacing: number, peak: number) {
  for (let i = 0; i < count; i++) {
    const click = noiseSource(ctx, 0.03)
    const band = ctx.createBiquadFilter()
    band.type = "bandpass"
    band.frequency.value = 2400 + Math.random() * 1600
    band.Q.value = 7
    const when = at + i * spacing + Math.random() * 0.015
    click.connect(band).connect(envelope(ctx, out, when, peak, 0.002, 0.03))
    click.start(when)
  }
}

const synth: Record<Exclude<SoundName, "ambience">, (ctx: AudioContext, out: AudioNode, at: number) => void> = {
  "coin-pickup": (ctx, out, at) => {
    // A short scrape off the floor, then the tink of the metal.
    const scrape = noiseSource(ctx, 0.25)
    const band = ctx.createBiquadFilter()
    band.type = "bandpass"
    band.frequency.setValueAtTime(1800, at)
    band.frequency.linearRampToValueAtTime(4200, at + 0.18)
    band.Q.value = 3
    scrape.connect(band).connect(envelope(ctx, out, at, 0.12, 0.02, 0.18))
    scrape.start(at)
    tone(ctx, out, "sine", 2400, at + 0.16, 0.05, 0.12)
    tone(ctx, out, "sine", 3610, at + 0.16, 0.025, 0.08)
  },
  "coin-insert": (ctx, out, at) => {
    clicks(ctx, out, at, 4, 0.04, 0.22)
    const thump = tone(ctx, out, "sine", 140, at + 0.2, 0.5, 0.22)
    thump.frequency.exponentialRampToValueAtTime(55, at + 0.42)
    const body = noiseSource(ctx, 0.12)
    const low = ctx.createBiquadFilter()
    low.type = "lowpass"
    low.frequency.value = 600
    body.connect(low).connect(envelope(ctx, out, at + 0.2, 0.35, 0.003, 0.1))
    body.start(at + 0.2)
  },
  "coin-reject": (ctx, out, at) => {
    clicks(ctx, out, at, 7, 0.05, 0.18)
    tone(ctx, out, "triangle", 1800, at + 0.45, 0.08, 0.25)
  },
  "power-up": (ctx, out, at) => {
    // The cabinet waking: a rising whine and the CRT's high-voltage thunk.
    const whine = tone(ctx, out, "sawtooth", 80, at, 0.05, 1.1)
    whine.frequency.exponentialRampToValueAtTime(900, at + 1.0)
    const thunk = noiseSource(ctx, 0.2)
    const low = ctx.createBiquadFilter()
    low.type = "lowpass"
    low.frequency.value = 300
    thunk.connect(low).connect(envelope(ctx, out, at, 0.4, 0.004, 0.18))
    thunk.start(at)
    tone(ctx, out, "sine", 15700, at + 0.1, 0.012, 1.4)
  },
  glitch: (ctx, out, at) => {
    const hiss = noiseSource(ctx, 0.8)
    const band = ctx.createBiquadFilter()
    band.type = "bandpass"
    band.Q.value = 2
    band.frequency.setValueAtTime(400, at)
    band.frequency.exponentialRampToValueAtTime(6000, at + 0.7)
    hiss.connect(band).connect(envelope(ctx, out, at, 0.12, 0.02, 0.75))
    hiss.start(at)
  },
  boot: (ctx, out, at) => {
    // A POST beep and drive-seek chatter.
    tone(ctx, out, "square", 1000, at, 0.05, 0.12)
    clicks(ctx, out, at + 0.3, 10, 0.09, 0.06)
  },
  start: (ctx, out, at) => {
    for (const [index, frequency] of [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].entries()) {
      tone(ctx, out, "square", frequency, at + index * 0.09, 0.06, 0.14)
    }
  },
  "menu-move": (ctx, out, at) => {
    tone(ctx, out, "square", 660, at, 0.045, 0.05)
  },
  "power-off": (ctx, out, at) => {
    // The tube switching off: a falling whine, a soft thunk and the high-voltage tick.
    const whine = tone(ctx, out, "sawtooth", 900, at, 0.04, 0.4)
    whine.frequency.exponentialRampToValueAtTime(60, at + 0.38)
    const thunk = noiseSource(ctx, 0.12)
    const low = ctx.createBiquadFilter()
    low.type = "lowpass"
    low.frequency.value = 260
    thunk.connect(low).connect(envelope(ctx, out, at + 0.05, 0.3, 0.004, 0.12))
    thunk.start(at + 0.05)
    tone(ctx, out, "sine", 2200, at + 0.32, 0.03, 0.05)
  },
  "menu-select": (ctx, out, at) => {
    tone(ctx, out, "square", 880, at, 0.05, 0.06)
    tone(ctx, out, "square", 1320, at + 0.07, 0.05, 0.1)
  },
}
