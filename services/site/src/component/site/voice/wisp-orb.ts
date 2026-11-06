// The voice orb from OpenCode Mobile's Living Orb call (opencode-ios `OpenCode/Voice/WispOrb.metal`
// and `WispOrbSim.swift`, themselves a port of Wisp's `wisp-orb` crate): a dark glass lens over a
// lattice of LED dots, lit by the wave traces of both voices with a fast and a slow phosphor per dot.
// The 240 Hz simulation and the per-dot light are ported line for line where they are kept; the
// refractive gaze, tool choreography and the blinking personalities are left out. Dots are drawn
// with Canvas 2D, one halo and one dot each, as the Metal fragment does.

export type OrbState = "sleeping" | "connecting" | "listening" | "thinking" | "speaking" | "error"

const STEP = 1 / 240
const TAU = Math.PI * 2
const TRACE = 64
const SPEEDS = [0.8, 1.25, 1.85, 2.6]
const BASE0 = 0.55
const USER_SEEDS = [0.15, 1.72, 3.31, 4.64]
const AGENT_SEEDS = [2.42, 0.63, 5.12, 1.91]
const SPIRAL_AXIS = [-0.2592, 0.8674, 0.4249]
const SPIRAL_E1 = [0.9585, 0.1798, 0.2214]
const SPIRAL_AXIS_B = [0.3124, 0.8486, 0.4269]
const SPIRAL_E1_B = [0.941, -0.2215, -0.2558]
const USER_BASE = [0.6, 0.9, 0.98]
const USER_CORE = [0.96, 0.99, 1.0]
const AGENT_BASE = [0.44, 0.91, 0.68]
const AGENT_CORE = [0.99, 0.93, 0.72]
const FRINGE = [1.0, 0.95, 0.78]

// Wisp's `OrbTuning` defaults (WispOrbTunables.swift).
const tuning = {
  contrast: 2.6,
  brightness: 1.15,
  response: 2.9,
  interference: 0.68,
  phosphor: 0.62,
  dotSize: 0.78,
  glow: 0.42,
  restScale: 0.76,
}

const ws = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
const bump = (d: number, w: number) => Math.exp(-(d / w) * (d / w))
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const pow01 = (x: number, y: number) => (x <= 1e-6 ? 0 : x >= 1 ? 1 : Math.pow(x, y))
const spow = (x: number, y: number) => (x <= 0 ? 0 : Math.pow(x, y))
const mix3 = (a: number[], b: number[], t: number) => {
  const k = clamp(t, 0, 1)
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const SPIRAL_E2 = cross3(SPIRAL_AXIS, SPIRAL_E1)
const SPIRAL_E2_B = cross3(SPIRAL_AXIS_B, SPIRAL_E1_B)

/** Critically damped spring, integrated analytically (`WispSpring`). */
function settle(s: { x: number; v: number }, target: number, duration: number, h: number) {
  const w = TAU / Math.max(duration, 1e-3)
  const y = s.x - target
  const c = s.v + w * y
  const decay = Math.exp(-w * h)
  s.x = target + (y + c * h) * decay
  s.v = (s.v - w * c * h) * decay
}

/** 35 ms attack / 95 ms release envelope, onset kick and band follower (`WispVoiceChannel`). */
function voice() {
  return { level: 0, reservoir: 0, energy: 0, kick: 0, kickVelocity: 0, band: 0 }
}
function stepVoice(v: ReturnType<typeof voice>, raw: number, h: number) {
  const previous = v.level
  v.level += (raw - v.level) * (1 - Math.exp(-h / (raw > v.level ? 0.035 : 0.095)))
  const rise = Math.max((v.level - previous) / h, 0)
  v.reservoir = Math.max(v.reservoir + (1.75 * v.level * v.level - v.reservoir / 1.8) * h, 0)
  v.energy = 1 - Math.exp(-v.reservoir * 1.45)
  const w = TAU * 1.3
  v.kickVelocity += (-w * w * v.kick - 2 * 0.22 * w * v.kickVelocity + 15 * rise + 2.2 * v.level) * h
  v.kick = clamp(v.kick + v.kickVelocity * h, -1.5, 2.5)
  v.band += (raw - v.band) * (1 - Math.exp(-h / (raw > v.band ? 0.025 : 0.14)))
}

/** The delayed wave history a voice leaves across the lens (`WispWaveTrace`). */
function trace(seeds: number[]) {
  return {
    envelope: 0,
    amplitude: 0,
    amplitudeVelocity: 0,
    glowFast: 0,
    glowSpring: 0,
    glowSpringVelocity: 0,
    glowSlow: 0,
    glow: 0,
    phases: [...seeds],
    // (amplitude, first harmonic) per step, newest at `head - 1`.
    history: new Float32Array(TRACE * 2),
    head: 0,
  }
}
function tickTrace(t: ReturnType<typeof trace>, v: ReturnType<typeof voice>, gate: number, h: number) {
  const follow = (value: number, target: number, rise: number, fall: number) =>
    value + (target - value) * (1 - Math.exp(-h / (target > value ? rise : fall)))
  t.envelope = follow(t.envelope, v.level, 0.022, clamp(0.06 + 0.12 * tuning.phosphor, 0.05, 0.3))
  const w = TAU * clamp(tuning.response, 0.5, 6)
  t.amplitudeVelocity += (-w * w * (t.amplitude - t.envelope) - 2 * 0.52 * w * t.amplitudeVelocity) * h
  t.amplitude += t.amplitudeVelocity * h
  t.glowFast = follow(t.glowFast, v.level, 0.045, 0.13)
  const gw = TAU * 3.6
  t.glowSpringVelocity += (-gw * gw * (t.glowSpring - t.glowFast) - 2 * 0.5 * gw * t.glowSpringVelocity) * h
  t.glowSpring += t.glowSpringVelocity * h
  t.glowSlow = follow(t.glowSlow, v.level, 0.15, 0.7)
  const swell = 0.8 * Math.max(t.glowSpring - 0.22, 0) + 0.05 * Math.max(v.kick, -0.5)
  t.glow = Math.min(Math.max(swell, 0) + 0.42 * t.glowSlow + 0.22 * v.energy, 1.25) * gate
  const go = 0.6 + 1.1 * Math.min(t.envelope * 1.6, 1)
  for (let i = 0; i < 4; i++) t.phases[i] = (t.phases[i] + h * TAU * SPEEDS[i] * go) % TAU
  const emphasis = 0.35 + 0.65 * Math.min(v.band / (v.band + 0.06), 2)
  const amp = Math.max(t.amplitude, 0) * gate
  t.history[t.head * 2] = amp
  t.history[t.head * 2 + 1] = amp * BASE0 * emphasis
  t.head = (t.head + 1) % TRACE
}
/** `tracePast`: lerp between steps `delay / STEP` and the one before. */
function past(t: ReturnType<typeof trace>, delay: number, out: number[]) {
  const d = clamp(delay / STEP, 0, TRACE - 2)
  const i = Math.floor(d)
  const k = d - i
  const a = (t.head + 2 * TRACE - 1 - i) % TRACE
  const b = (a + TRACE - 1) % TRACE
  out[0] = t.history[a * 2] * (1 - k) + t.history[b * 2] * k
  out[1] = t.history[a * 2 + 1] * (1 - k) + t.history[b * 2 + 1] * k
}

// `WispModeMix.gains` and `palette`.
const gains: Record<OrbState, [number, number]> = {
  sleeping: [0.38, 0.08],
  error: [0.16, 0.08],
  connecting: [0.25, 0.25],
  listening: [1.0, 0.35],
  speaking: [0.35, 1.0],
  thinking: [0.3, 0.2],
}
const palettes: Record<OrbState, [number[], number[]]> = {
  sleeping: [
    [0.52, 0.7, 0.65],
    [0.84, 0.93, 0.9],
  ],
  connecting: [
    [0.56, 0.85, 0.95],
    [0.93, 0.98, 1.0],
  ],
  listening: [
    [0.64, 0.9, 0.96],
    [0.97, 0.99, 1.0],
  ],
  thinking: [
    [0.55, 0.72, 0.98],
    [0.93, 0.96, 1.0],
  ],
  speaking: [
    [0.44, 0.91, 0.68],
    [0.99, 0.93, 0.72],
  ],
  error: [
    [0.84, 0.38, 0.45],
    [0.96, 0.7, 0.74],
  ],
}
const isRest = (state: OrbState) => state === "sleeping"
const mixKeys = ["sleep", "comet", "think", "error", "live", "uGain", "aGain"] as const
const mixTarget = (state: OrbState) => ({
  sleep: state === "sleeping" ? 1 : 0,
  comet: state === "connecting" ? 1 : 0,
  think: state === "thinking" ? 1 : 0,
  error: state === "error" ? 1 : 0,
  live: state === "listening" || state === "speaking" || state === "thinking" ? 1 : 0,
  uGain: gains[state][0],
  aGain: gains[state][1],
})
const mixDurations = { sleep: 0.38, comet: 0.34, think: 0.34, error: 0.34, live: 0.36, uGain: 0.32, aGain: 0.32 }

/** Wisp's `OrbSim`, trimmed to the states the site's voice mode uses. */
export class OrbSim {
  state: OrbState = "sleeping"
  private initialized = false
  private pending = 0
  private renderDt = 0
  time = 0
  phase = 0
  private stateElapsed = 0
  private cometAngle = 0
  private ignition = 0
  private swirlVelocity = 0
  private pourProgress = -1
  user = voice()
  agent = voice()
  userTrace = trace(USER_SEEDS)
  agentTrace = trace(AGENT_SEEDS)
  mix = { ...mixTarget("sleeping") }
  private mixVel: Record<string, number> = {}
  tintBase = [...palettes.sleeping[0]]
  tintCore = [...palettes.sleeping[1]]
  private tintBaseVel = [0, 0, 0]
  private tintCoreVel = [0, 0, 0]
  rimUser = 0
  rimAgent = 0
  scale = { x: tuning.restScale, v: 0 }
  private gatherFrom = tuning.restScale
  wakeAge = -1
  sleepAge = -1
  coolEmber = 0
  duck = 0
  band = { x: 0, v: 0 }
  bandPhase = 0
  ambientGlow = 0
  private voicePush = 0
  reduceMotion = false

  step(dt: number, user: number, agent: number, next: OrbState, reduceMotion: boolean) {
    const h = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25)
    if (!this.initialized) {
      this.state = next
      this.mix = { ...mixTarget(next) }
      this.tintBase = [...palettes[next][0]]
      this.tintCore = [...palettes[next][1]]
      this.scale = { x: isRest(next) ? tuning.restScale : 1, v: 0 }
      this.initialized = true
    } else if (next !== this.state) {
      if (this.state === "connecting" && next !== "sleeping" && next !== "error") {
        this.swirlVelocity = Math.min(this.swirlVelocity + 1.1 * TAU * 0.62, 14)
        this.pourProgress = 0
      }
      if (isRest(this.state) && !isRest(next)) {
        this.gatherFrom = this.scale.x
        this.wakeAge = 0
        this.swirlVelocity = Math.min(this.swirlVelocity + 2.35, 14)
      }
      if (!isRest(this.state) && isRest(next)) {
        this.sleepAge = 0
        this.coolEmber = Math.min(
          Math.max(this.coolEmber, 0.4 + 0.36 * clamp(Math.max(this.user.energy, this.agent.energy), 0, 1)),
          0.84,
        )
      }
      if (next === "connecting" && this.mix.comet < 0.02) this.ignition = 0
      this.state = next
      this.stateElapsed = 0
    }
    this.reduceMotion = reduceMotion
    this.renderDt = Math.min(this.renderDt + h, 0.25)
    this.pending += h
    while (this.pending >= STEP) {
      this.pending -= STEP
      this.tick(clamp(user, 0, 1), clamp(agent, 0, 1))
    }
  }

  private tick(userRaw: number, agentRaw: number) {
    const h = STEP
    const target = mixTarget(this.state)
    for (const key of mixKeys) {
      const s = { x: this.mix[key], v: this.mixVel[key] ?? 0 }
      settle(s, target[key], mixDurations[key], h)
      this.mix[key] = s.x
      this.mixVel[key] = s.v
    }
    const rm = this.reduceMotion
    const still: [number, number] =
      this.state === "listening" ? [0.36, 0] : this.state === "speaking" ? [0, 0.42] : [0, 0]
    const u = rm ? still[0] : userRaw * this.mix.uGain
    const a = rm ? still[1] : agentRaw * this.mix.aGain
    stepVoice(this.user, u, h)
    stepVoice(this.agent, a, h)
    const rimAlpha = 1 - Math.exp(-h / 0.18)
    this.rimUser += (ws(0.02, 0.3, this.user.level) - this.rimUser) * rimAlpha
    this.rimAgent += (ws(0.02, 0.3, this.agent.level) - this.rimAgent) * rimAlpha

    // `WispPowerSim.tick`: the wake bloom and the hang-up contraction.
    if (this.wakeAge >= 0) {
      this.wakeAge += h
      if (this.wakeAge < 0.035) settle(this.scale, Math.max(this.gatherFrom - 0.038, 0.5), 0.042, h)
      else settle(this.scale, 1, 0.36, h)
      if (this.wakeAge >= 0.52 && Math.abs(this.scale.x - 1) < 8e-4) this.wakeAge = -1
    } else {
      settle(this.scale, isRest(this.state) ? tuning.restScale : 1, isRest(this.state) ? 0.42 : 0.36, h)
    }
    if (this.sleepAge >= 0) {
      this.sleepAge += h
      if (this.sleepAge >= 0.68) this.sleepAge = -1
    }
    if (this.coolEmber > 0) {
      this.coolEmber *= Math.exp(-h / 0.22)
      if (this.coolEmber < 1e-3) this.coolEmber = 0
    }

    const speech = ws(0.03, 0.22, this.user.level + this.agent.level)
    this.duck += (clamp(0.55 * speech, 0, 1) - this.duck) * (1 - Math.exp(-h / 0.16))
    const gate = clamp(0.25 + 0.75 * this.mix.live, 0, 1)
    tickTrace(this.userTrace, this.user, gate, h)
    tickTrace(this.agentTrace, this.agent, gate, h)

    const [goalBase, goalCore] = palettes[this.state]
    const w = TAU / 0.34
    const decay = Math.exp(-w * h)
    for (let c = 0; c < 3; c++) {
      const yb = this.tintBase[c] - goalBase[c]
      const cb = this.tintBaseVel[c] + w * yb
      this.tintBase[c] = goalBase[c] + (yb + cb * h) * decay
      this.tintBaseVel[c] = (this.tintBaseVel[c] - w * cb * h) * decay
      const yc = this.tintCore[c] - goalCore[c]
      const cc = this.tintCoreVel[c] + w * yc
      this.tintCore[c] = goalCore[c] + (yc + cc * h) * decay
      this.tintCoreVel[c] = (this.tintCoreVel[c] - w * cc * h) * decay
    }

    this.time += h
    this.stateElapsed += h
    if (this.state === "connecting") this.ignition = ws(0, 1.6, this.stateElapsed)
    this.cometAngle = (this.cometAngle + h * TAU * 1.1 * (0.45 + 0.55 * this.ignition)) % TAU
    if (this.pourProgress >= 0) {
      this.pourProgress += h / 0.46
      if (this.pourProgress >= 1) this.pourProgress = -1
    }
    // The coupled medium's thinking bands (a stand-in for `WispCouplingSim`'s band springs).
    settle(this.band, this.state === "thinking" ? 0.55 : 0, 0.5, h)
    this.bandPhase = (this.bandPhase + h * TAU * 0.35) % TAU
    this.swirlVelocity *= Math.exp(-h / 0.42)

    const awake = 0.08 * (1 - this.mix.sleep)
    const glowGoal =
      (this.userTrace.glow + this.agentTrace.glow) * 0.55 +
      0.3 * this.mix.comet +
      0.35 * this.mix.think +
      awake +
      0.22 * this.coolEmber
    this.ambientGlow += (glowGoal - this.ambientGlow) * (1 - Math.exp(-h / 0.18))

    const drift = 0.3 * this.mix.sleep + 0.88 * (1 - this.mix.sleep)
    const voiceDrive0 = (this.user.level + this.agent.level) * tuning.response
    this.voicePush += (voiceDrive0 - this.voicePush) * (1 - Math.exp(-h / (voiceDrive0 > this.voicePush ? 0.14 : 0.45)))
    const voiceDrive = voiceDrive0 + (this.voicePush - voiceDrive0) * this.mix.think
    this.phase += h * (drift + voiceDrive + 0.36 * this.mix.think + this.swirlVelocity * 0.42)
  }

  frame() {
    const dt = clamp(this.renderDt, 0, 0.25)
    this.renderDt = 0
    return {
      dt,
      comet: this.cometAngle,
      ignition: this.ignition,
      pour: this.pourProgress,
    }
  }
}

/**
 * Optional sphere shading for larger renders (the Mobile card cover); the voice orb uses none.
 * `edge`: the outer fraction of the radius over which dots shrink and fade out. `wrap`: the lattice
 * wraps onto the sphere, so dots bunch towards the limb. `key` (0–1): a key light from the top left,
 * brighter and larger dots there, falling to a soft terminator at the bottom right. `limb` (0–1):
 * darkening towards the edge. `bare`: no plate, shadow, ambient glow or rim (the caller draws its own
 * body). `halo`: how much of each dot's glow to keep (1 = all). `gain`: dot brightness.
 */
export type OrbLook = {
  edge?: number
  wrap?: boolean
  key?: number
  limb?: number
  bare?: boolean
  halo?: number
  gain?: number
}
const KEY = (() => {
  const v = [-0.5, -0.62, 0.6]
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
})()

/** Draws an `OrbSim` into a canvas: the plate, the ambient glow, the dot lattice and the rim light. */
export class OrbRenderer {
  private ctx: CanvasRenderingContext2D
  private cols: number
  private phosphor: Float32Array
  private readonly past = [0, 0]

  constructor(
    private canvas: HTMLCanvasElement,
    // The lens diameter and dot pitch, CSS px. Wisp's are 88 and 2.2 pt.
    private diameter: number,
    private pitch: number,
    private look: OrbLook = {},
  ) {
    this.ctx = canvas.getContext("2d")!
    this.cols = Math.max(8, Math.ceil(diameter / pitch))
    this.phosphor = new Float32Array(this.cols * this.cols * 4)
  }

  /**
   * `shadow` is Settings › Orb shadow, 0–1: 0.5 is the designed look. `solid` (0–1) covers the orb
   * with a plain circle, the site's resting look: black in light mode, near-black with a faint keyline
   * in dark mode. At 1 only the circle and its shadow are drawn.
   */
  draw(sim: OrbSim, dark: boolean, shadow = 0.5, solid = 0) {
    const f = sim.frame()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const box = this.canvas.clientWidth
    const size = Math.round(box * dpr)
    if (this.canvas.width !== size) {
      this.canvas.width = size
      this.canvas.height = size
    }
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box, box)
    ctx.translate(box / 2, box / 2)

    const rm = sim.reduceMotion
    const scale = clamp(sim.scale.x, 0.5, 1.08)
    const radius = Math.max(this.diameter * 0.5 * scale, 4)
    const pitch = this.pitch
    const cols = this.cols
    const off = (cols - 1) * 0.5
    const maxR2 = Math.max(1 - 0.85 / radius, 0) ** 2
    const look = this.look
    const edge = look.edge ?? 0
    const keyLight = look.key ?? 0
    const limb = look.limb ?? 0
    const still = rm || f.dt <= 0
    const fastFall = still ? 0 : Math.exp(-f.dt / Math.max(0.045 + 0.04 * tuning.phosphor, 0.015))
    const slowFall = still ? 0 : Math.exp(-f.dt / Math.max(0.14 + 0.58 * tuning.phosphor, 0.05))
    const trail = clamp(0.18 + 0.34 * tuning.phosphor, 0, 0.72)
    const ambient = sim.ambientGlow * tuning.glow

    // The glass floats on layered, low-opacity shadows like the site's pop-ups: each a Gaussian blur
    // a little further down. Canvas shadows ignore the transform, so they're scaled to device pixels.
    // On a dark page a faint, wider one is enough.
    const layers = dark
      ? [
          [1, 2, 0.35],
          [6, 16, 0.3],
        ]
      : [
          [1, 2, 0.06],
          [2, 5, 0.06],
          [6, 14, 0.07],
          [12, 28, 0.05],
        ]
    // 0 removes it; up to 0.5 it fades in at the designed size; past that it darkens and spreads a
    // little (blur and drop × 1.4 at 1), so even full strength stays soft.
    const strength = clamp(shadow, 0, 1) * 2
    const spread = 1 + 0.4 * Math.max(strength - 1, 0)
    ctx.save()
    ctx.fillStyle = "rgb(16,16,16)"
    for (const [y, blur, alpha] of strength > 0.001 && !look.bare ? layers : []) {
      ctx.shadowColor = `rgba(0,0,0,${Math.min(alpha * strength, dark ? 0.8 : 0.3)})`
      ctx.shadowBlur = blur * spread * dpr
      ctx.shadowOffsetY = y * spread * dpr * scale
      ctx.beginPath()
      ctx.arc(0, 0, radius - 0.5, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
    const drawSolid = () => {
      ctx.fillStyle = dark ? "#0f0f0f" : "#000"
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, TAU)
      ctx.fill()
      if (!dark) return
      ctx.strokeStyle = "rgba(255,255,255,0.14)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(0, 0, radius - 0.5, 0, TAU)
      ctx.stroke()
    }
    if (solid >= 0.999) return drawSolid()
    if (!look.bare) {
      ctx.fillStyle = "rgba(16,16,16,0.94)"
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, TAU)
      ctx.fill()
    }
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, TAU)
    ctx.clip()
    const glowStrength = 0.17 * clamp(ambient, 0, 1.2)
    if (glowStrength > 0.004 && !look.bare) {
      const reach = radius * (0.82 + 0.35 * Math.min(ambient, 1))
      const mid = mix3(sim.tintBase, sim.tintCore, 0.5)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, reach)
      g.addColorStop(0, rgba(mid, glowStrength))
      g.addColorStop(1, rgba(sim.tintBase, 0))
      ctx.fillStyle = g
      ctx.fillRect(-reach, -reach, reach * 2, reach * 2)
    }

    const breath = rm ? 0.5 : 0.5 + 0.5 * Math.sin((sim.time * TAU) / 5.5)
    const sleepMix = sim.mix.sleep
    const cometMix = sim.mix.comet
    const thinkMix = sim.mix.think
    const userLevel = sim.user.level
    const agentLevel = sim.agent.level
    const presence = clamp(clamp(0.34 + 0.4 * userLevel, 0.34, 0.58) * sleepMix + 0.92 * (1 - sleepMix), 0.24, 1)
    const uKick = rm ? 0 : clamp(sim.user.kick, -0.4, 1.2) * 0.24
    const aKick = rm ? 0 : clamp(sim.agent.kick, -0.4, 1.2) * 0.24
    const phase = sim.phase
    const sinUx = Math.sin(phase * 0.41),
      cosUx = Math.cos(phase * 0.41)
    const sinUy = Math.sin(phase * 0.31),
      cosUy = Math.cos(phase * 0.31)
    const aPhase = -phase + 2.15
    const sinAx = Math.sin(aPhase * 0.39),
      cosAx = Math.cos(aPhase * 0.39)
    const sinAy = Math.sin(aPhase * 0.29),
      cosAy = Math.cos(aPhase * 0.29)
    const bandGain = 1 - 0.72 * sim.duck
    const phaseDiff = sim.userTrace.phases[0] - sim.agentTrace.phases[0]
    const bandU = sim.band.x
    const bandA = sim.band.x * 0.85
    const idleYaw = 0.16 * Math.sin(0.21 * sim.time)
    const idlePitch = 0.09 * Math.sin(0.17 * sim.time + 1)
    const syI = Math.sin(idleYaw),
      cyI = Math.cos(idleYaw),
      spI = Math.sin(idlePitch),
      cpI = Math.cos(idlePitch)
    const p = this.past
    const n = [0, 0, 0]

    for (let gy = 0; gy < cols; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const idx = (gy * cols + gx) * 4
        // With `wrap`, a cell at lattice radius l sits at sin(l·π/2) on the lens and its dot shrinks with
        // the local spacing, as if the lattice were drawn on the sphere.
        const lx = (gx - off) * pitch
        const ly = (gy - off) * pitch
        const lr = Math.hypot(lx, ly) / radius
        const theta = (lr * Math.PI) / 2
        const warp = look.wrap && lr > 1e-6 && lr < 1 ? Math.sin(theta) / lr : 1
        const spacing = look.wrap && lr < 1 ? Math.sqrt(Math.cos(theta) * (lr > 1e-6 ? warp : 1)) : 1
        const cx = lx * warp
        const cy = ly * warp
        const nx = cx / radius
        const ny = cy / radius
        const r2 = nx * nx + ny * ny
        if (r2 >= maxR2) {
          this.phosphor[idx] *= fastFall
          this.phosphor[idx + 1] *= slowFall
          this.phosphor[idx + 2] *= fastFall
          this.phosphor[idx + 3] *= slowFall
          continue
        }
        const r = Math.sqrt(r2)
        const mask = ws(0.85, 4.2, radius * (1 - r))
        const z = Math.sqrt(Math.max(1 - r2, 0))
        n[0] = nx
        n[1] = ny
        n[2] = z

        // `couplingCell`, Harmonic Twist at rest: thinking lights the crown and two latitude bands.
        const crown = 0.76 + 0.24 * Math.max(z, 0)
        const thinkU = 0.72 * crown
        const thinkA = 0.14 * crown
        const lat = Math.asin(clamp(ny, -1, 1))
        const argU = bandU * Math.sin(5 * lat + sim.bandPhase)
        const argA = bandA * Math.sin(5 * lat - sim.bandPhase)

        // `powerSample`: the wake ripple and the hang-up pull.
        let pArg = 0,
          pFlat = 0,
          pWave = 0
        if (!rm && (sim.wakeAge >= 0 || sim.sleepAge >= 0 || sim.coolEmber > 1e-3)) {
          const rho = Math.acos(clamp(z, 0, 1))
          const wakeAge = sim.wakeAge
          if (wakeAge >= 0) {
            if (wakeAge < 0.035) {
              const g = clamp(wakeAge / 0.035, 0, 1)
              pArg -= 0.55 * g * rho
              const k = 0.48 * g * bump(rho, 0.38)
              pFlat += 0.38 * k
              pWave += 0.62 * k
            } else {
              const t = wakeAge - 0.035
              const uu = clamp(t / 0.36, 0, 1.35)
              const front = 1.65 * (1 - Math.exp(-2.15 * uu))
              const env = ws(0, 0.04, t) * (1 - ws(0.24, 0.52 - 0.035, t))
              pArg += 1.05 * env * Math.sin(3.6 * rho - 8.8 * t)
              const k = env * (0.64 * bump(rho - front, 0.3) + 0.26 * (1 - ws(0, Math.max(front + 0.24, 0.25), rho)))
              pFlat += 0.22 * k
              pWave += 0.78 * k
            }
          }
          if (sim.sleepAge >= 0 || sim.coolEmber > 1e-3) {
            const age = Math.max(sim.sleepAge, 0)
            const rise = sim.sleepAge >= 0 ? ws(0, 0.075, age) : 1
            const pull = rise * (1 - ws(0.12, 0.68, age)) * sim.coolEmber
            pArg += 0.95 * pull * Math.sin(3.4 * rho + 6.8 * age)
            const k = rise * sim.coolEmber * (0.24 + 0.76 * z * z) * 1.15
            pFlat += 0.2 * k
            pWave += 0.8 * k
          }
        }

        // The user's ribbon enters from the left.
        past(sim.userTrace, (nx + 1) * 0.5 * 0.24, p)
        const uAmp = p[0],
          uH1 = p[1]
        const onsetU = uKick === 0 ? 0 : Math.sin(Math.sqrt((nx + 0.42) ** 2 + ny * ny) * 9.5 - phase * 2.3) * uKick
        const uu = nx * cosUx + z * sinUx
        const uv = ny * cosUy - z * sinUy
        const waveU =
          Math.sin(5.1 * (uu + uv * 0.46) + phase * 1.12 + onsetU + 1.15 * uH1 + argU + pArg) *
          Math.cos(5.1 * (uv - uu * 0.34) - phase * 0.82)
        const bodyU = pow01(Math.max(0.5 + 0.5 * waveU, 0), tuning.contrast)
        const reachU = 1 - 0.34 * ws(-0.25, 0.95, nx) * (1 - Math.min(uAmp, 1))

        // The agent's counter-rotating ribbon enters from the right.
        past(sim.agentTrace, (1 - nx) * 0.5 * 0.24, p)
        const aAmp = p[0],
          aH1 = p[1]
        const onsetA = aKick === 0 ? 0 : Math.sin(Math.sqrt((nx - 0.42) ** 2 + ny * ny) * 9.5 - phase * 2.1) * aKick
        const au = nx * cosAx + z * sinAx
        const av = ny * cosAy - z * sinAy
        const waveA =
          Math.sin(4.9 * (au - av * 0.44) - phase * 1.08 + onsetA + 1.15 * aH1 + argA - 0.72 * pArg) *
          Math.cos(4.9 * (av + au * 0.36) + phase * 0.78)
        const bodyA = pow01(Math.max(0.5 + 0.5 * waveA, 0), tuning.contrast)
        const reachA = 1 - 0.34 * ws(-0.25, 0.95, -nx) * (1 - Math.min(aAmp, 1))

        // `specialLight`: the ignition spiral and pour, error, and the sleeping ember.
        let special = 0
        if (cometMix > 0.005 || f.pour >= 0) {
          const theta = Math.acos(clamp(dot3(n, SPIRAL_AXIS), -1, 1))
          const phi = Math.atan2(dot3(n, SPIRAL_E2), dot3(n, SPIRAL_E1))
          if (cometMix > 0.005) special += cometMix * ignition(rm, n, theta, phi, f.comet, f.ignition, sim.time)
          if (f.pour >= 0) {
            const fade = ws(0, 0.24, f.pour) * (1 - ws(0.46, 1, f.pour))
            special += fade * bump(theta - 1.48, 0.18 + 0.85 * f.pour) * 0.54 * (0.38 + 0.62 * ws(-0.35, 0.55, z))
          }
        }
        if (sim.mix.error > 0.005) special += sim.mix.error * (0.16 + 0.1 * breath) * (0.5 + 0.5 * bodyU)
        if (sleepMix > 1e-3) {
          const x1 = nx * cyI - z * syI
          const z1 = nx * syI + z * cyI
          const qx = x1,
            qy = ny * cpI - z1 * spI,
            qz = ny * spI + z1 * cpI
          if (qz > 0) {
            const t = rm ? 0 : sim.time
            const b = 0.5 + 0.5 * Math.sin((t * TAU) / 5.4)
            const ex = 0.22 * Math.sin(0.41 * t)
            const ey = 0.18 + 0.14 * Math.cos(0.31 * t + 1.1)
            const core = bump(Math.hypot(qx - ex, qy - ey), 0.34 + 0.08 * b) * (0.28 + 0.18 * b)
            const lon = Math.atan2(qx, qz)
            const la = Math.asin(clamp(qy, -1, 1))
            const tideA =
              bump(la - (0.22 * Math.sin(1.5 * lon - 0.58 * t) + 0.14), 0.19) * (0.45 + 0.55 * Math.cos(lon - 0.62 * t))
            const tideB =
              bump(la - (-0.18 * Math.sin(2 * lon + 0.43 * t + 1.7) - 0.06), 0.22) *
              (0.45 + 0.55 * Math.cos(lon + 0.48 * t + 2.1))
            special += sleepMix * (core + 0.24 * tideA + 0.17 * tideB) * ws(0, 0.25, qz)
          }
        }
        const pwrLight = pFlat + pWave * bodyU
        const idleFloor =
          0.032 * (1 - 0.48 * sleepMix) +
          (0.055 + 0.055 * breath) * sleepMix * (0.18 + 0.82 * bodyU) +
          0.11 * (1 - sleepMix) * bodyU * (1 - 0.65 * cometMix)

        const thinkExcU = thinkU * (0.05 + 0.95 * bodyU)
        const thinkExcA = thinkA * (0.05 + 0.95 * bodyA)
        const voiceU = bodyU * uAmp * tuning.response * 0.92 * reachU
        let uExc = clamp(
          (idleFloor + voiceU + special + pwrLight + thinkMix * bandGain * thinkExcU) * tuning.brightness,
          0,
          1.15,
        )
        let aExc = clamp(
          (bodyA * aAmp * tuning.response * 0.92 * reachA + thinkMix * bandGain * thinkExcA) * tuning.brightness,
          0,
          1.15,
        )

        // `crisp_overlap`.
        const voiceDuo = ws(0.04, 0.3, Math.sqrt(Math.max(uAmp, 0) * Math.max(aAmp, 0)))
        const duoK = Math.max(voiceDuo, 0.75 * thinkMix * bandGain * ws(0.24, 0.5, thinkA))
        if (duoK > 0) {
          const crest = 0.26 * duoK * Math.sqrt(bodyU * bodyA) * tuning.brightness
          const ceiling = 1.15 - 0.27 * duoK
          const nu = clamp(uExc * (1 - 0.34 * duoK * (1 - Math.sqrt(bodyA))) + crest, 0, ceiling)
          aExc = clamp(aExc * (1 - 0.34 * duoK * (1 - Math.sqrt(bodyU))) + crest, 0, ceiling)
          uExc = nu
        }

        // Standing interference fringes where the voices meet.
        const overlap = Math.sqrt(Math.max(uAmp, 0) * Math.max(aAmp, 0) * reachU * reachA)
        const standing = Math.max(0.5 + 0.5 * Math.cos(13 * nx + phaseDiff) * Math.cos(6.5 * ny), 0)
        const fringe = clamp(
          overlap * tuning.interference * standing * Math.sqrt(standing) * 0.85 * tuning.brightness,
          0,
          1,
        )

        const inU = Math.min(uExc + 0.55 * fringe, 1.15)
        const inA = Math.min(aExc + 0.55 * fringe, 1.15)
        const ph = this.phosphor
        if (rm) {
          ph[idx] = inU
          ph[idx + 1] = inU
          ph[idx + 2] = inA
          ph[idx + 3] = inA
        } else {
          ph[idx] = Math.max(inU, ph[idx] * fastFall)
          ph[idx + 1] = Math.max(inU, ph[idx + 1] * slowFall)
          ph[idx + 2] = Math.max(inA, ph[idx + 2] * fastFall)
          ph[idx + 3] = Math.max(inA, ph[idx + 3] * slowFall)
        }
        const eu = ph[idx] * (1 - trail) + ph[idx + 1] * trail
        const ea = ph[idx + 2] * (1 - trail) + ph[idx + 3] * trail
        const power = clamp(1 - (1 - Math.min(eu, 1)) * (1 - Math.min(ea, 1)), 0, 1)
        const fresh = clamp((inU + inA + 0.012) / (eu + ea + 0.024), 0, 1)

        // `Tone::cell`.
        let base = sim.tintBase
        let core = sim.tintCore
        const total = eu + ea
        const energyGate = ws(0.004, 0.055, total)
        const agentShare = clamp(0.5 + 0.5 * ((ea - eu) / (total + 0.025)) * energyGate, 0, 1)
        const duo = ws(0.03, 0.14, Math.min(userLevel, agentLevel))
        if (duo > 1e-3) {
          const fMix = clamp(fringe * 1.15, 0, 0.85)
          const d = duo * energyGate
          base = mix3(base, mix3(mix3(USER_BASE, AGENT_BASE, agentShare), FRINGE, fMix * 0.65), d)
          core = mix3(core, mix3(mix3(USER_CORE, AGENT_CORE, agentShare), FRINGE, fMix), d)
        }

        // `build_cell_render`.
        const pp = clamp(power, 1e-5, 1)
        const floorAlpha = 0.068 * (1 - 0.7 * ws(0.35, 0.95, r)) * presence
        // `OrbLook`: the edge dissolves, the key light brightens and enlarges the dots it faces, the
        // limb darkens. All 1 without a look.
        const fall = edge > 0 ? 1 - ws(1 - edge, 1, r) : 1
        const lambert = Math.max(dot3(n, KEY), 0)
        const lit = 1 + keyLight * (0.12 + 1.3 * Math.pow(lambert, 1.4) - 1)
        const dim = 1 - limb * (1 - (0.3 + 0.7 * z))
        const light = fall * lit * dim * (look.gain ?? 1)
        const dotA = Math.min(
          (floorAlpha + (0.96 - floorAlpha) * pow01(pp, 0.88 * (1.4 - 0.4 * fresh))) * mask * light,
          1,
        )
        const shrink = 1 + (0.82 + 0.18 * fresh - 1) * ws(0.03, 0.2, pp)
        const grow = (0.35 + 0.65 * fall) * (1 + keyLight * (0.82 + 0.3 * lambert - 1)) * spacing
        const dotR = (0.25 + 0.17 * pow01(pp, 0.6)) * shrink * pitch * (tuning.dotSize / 0.78) * grow
        const haloA =
          pp > 0.04
            ? clamp(0.132 * pp * pp * mask * light * (look.halo ?? 1) * clamp(tuning.glow / 0.42, 0, 3), 0, 0.85)
            : 0
        const rgb = mix3(base, core, clamp(pp * pp * 1.1, 0, 0.9) * (0.3 + 0.7 * fresh))
        if (dotA <= 0.002) continue
        const g = Math.round(luma(rgb) * 255)
        if (haloA > 0.003) {
          ctx.fillStyle = fill(g, haloA)
          ctx.beginPath()
          ctx.arc(cx, cy, dotR * 2, 0, TAU)
          ctx.fill()
        }
        ctx.fillStyle = fill(g, Math.min(dotA, 1))
        ctx.beginPath()
        ctx.arc(cx, cy, dotR, 0, TAU)
        ctx.fill()
      }
    }
    ctx.restore()
    if (look.bare) return

    // `RimLight::shade`: a Fresnel band inside the limb and a specular hairline, keyed from the top left
    // and tinted by whoever is speaking on each side.
    const left = mix3(sim.tintBase, USER_BASE, 0.75 * clamp(sim.rimUser, 0, 1))
    const right = mix3(sim.tintBase, AGENT_BASE, 0.75 * clamp(sim.rimAgent, 0, 1))
    const band = ctx.createLinearGradient(-radius * 0.55, -radius * 0.83, radius * 0.55, radius * 0.83)
    band.addColorStop(0, rgba(mix3(left, [1, 1, 1], 0.5), 0.55))
    band.addColorStop(0.55, rgba(mix3(mix3(left, right, 0.5), [1, 1, 1], 0.2), 0.12))
    band.addColorStop(1, rgba(mix3(right, [1, 1, 1], 0.3), 0.3))
    ctx.strokeStyle = band
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.arc(0, 0, radius - 0.45, 0, TAU)
    ctx.stroke()
    const fres = ctx.createRadialGradient(0, 0, radius - 2.6, 0, 0, radius)
    fres.addColorStop(0, rgba(sim.tintBase, 0))
    fres.addColorStop(1, rgba(mix3(mix3(left, right, 0.5), [1, 1, 1], 0.2), 0.1 + 0.12 * (sim.rimUser + sim.rimAgent)))
    ctx.fillStyle = fres
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, TAU)
    ctx.fill()
    if (solid <= 0.001) return
    ctx.globalAlpha = solid
    drawSolid()
    ctx.globalAlpha = 1
  }
}

function ignition(rm: boolean, n: number[], theta: number, phi: number, spin: number, ignite: number, time: number) {
  const depth = 0.24 + 0.76 * ws(-0.55, 0.55, n[2])
  if (rm) return 0.56 * bump(theta - (Math.PI * 0.5 - 0.12 * (1 - ignite)), 0.22) * depth
  const centre = 1.28 + 0.29 * ignite
  const delta = spin - phi
  const skewed = delta - 0.3 * Math.sin(delta)
  const swell = 0.22 + 0.78 * spow(0.5 + 0.5 * Math.cos(skewed), 1.45)
  const width = 0.19 + 0.05 * (1 - Math.max(n[2], 0))
  const wave = 0.045 * Math.sin(delta - 0.6 * time)
  const main = bump(theta - (centre + wave), width) * swell * depth
  const thetaB = Math.acos(clamp(dot3(n, SPIRAL_AXIS_B), -1, 1))
  const phiB = Math.atan2(dot3(n, SPIRAL_E2_B), dot3(n, SPIRAL_E1_B))
  const deltaB = 0.78 * spin + 2.1 - phiB
  const swellB = 0.2 + 0.8 * spow(0.5 + 0.5 * Math.cos(deltaB), 1.5)
  const sub = bump(thetaB - 1.54, 0.21) * swellB * (0.24 + 0.16 * ignite) * depth
  return 1.08 * main + sub
}

// Fill styles for the dots, built once: grey level × alpha in 64 steps, so a frame makes no strings.
const fills: string[] = []
function fill(grey: number, alpha: number) {
  const key = grey * 65 + Math.round(clamp(alpha, 0, 1) * 64)
  return (fills[key] ??= `rgba(${grey},${grey},${grey},${(key % 65) / 64})`)
}

// The site's orb is monochrome: every colour of Wisp's palette is drawn as its luminance, so the
// voices still read as brighter and dimmer light but never as teal, blue or gold.
const luma = (c: number[]) => clamp(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], 0, 1)

function rgba(c: number[], a: number) {
  const g = Math.round(luma(c) * 255)
  return `rgba(${g},${g},${g},${a})`
}
