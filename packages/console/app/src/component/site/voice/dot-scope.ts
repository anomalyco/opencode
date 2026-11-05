// Hex's recording indicator, Dot scope (anomalyco/hex `src/rune_hud/dot_scope/scope.rs` and
// `src/rune_hud.wgsl`): a plate of dots lit by a braided pair of oscilloscope traces that follow the
// voice. The 240 Hz simulation, the auto level and the beam are ported from the Rust; the plate is
// drawn with Canvas 2D instead of the WGSL fragment. Hex has one voice; here the assistant's reply
// drives the same braid in Hex's "processing" blue, and thinking is Hex's Flow look.

export type ScopeStage = "recording" | "speaking" | "processing" | "done" | "failed"

const STEP = 1 / 240
const TAU = Math.PI * 2
const HISTORY = 512
const SUB = 3
const SPEEDS = [0.8, 1.25, 1.85, 2.6]
const BASE = [0.55, 0.42, 0.3, 0.2]
const SPATIAL = [1.4, 2.4, 3.8, 5.6]
const START_WIDTH = 30
const ENTER = 0.42
const WIPE = 0.3
const PHOSPHOR_HEAD = 0.15
const BREATH_PERIOD = 5.5
const HIDDEN_SCALE = 0.9
const HIDDEN_SOFTNESS = 3
const WORK_HELIX = 2.6
const FLOW_SPACING = 0.7
const CARRIER_REST = 0.14

// `Tuning::default()`, the prototype's values.
export const scopeTuning = {
  columns: 43,
  rows: 9,
  spacing: 2.6,
  width: 112,
  processingWidth: 76,
  height: 26,
  braidSpeed: 1,
  helixCycles: 1.6,
  gain: 1,
  response: 6.5,
  release: 0.15,
  historySpeed: 150,
  phosphor: 0.6,
  glow: 1,
  shimmerPass: 0.55,
  shimmer: 1,
  transition: 0.3,
  bounce: 0.15,
  autoRelease: 3,
  noiseFloor: -60,
}
const T = scopeTuning

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
const bump = (d: number, w: number) => Math.exp(-(d / w) * (d / w))
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const mod = (a: number, m: number) => ((a % m) + m) % m

/** A meter's RMS as dBFS (`loudness`). */
export const loudness = (rms: number) => 20 * Math.log10(Math.max(rms, 0) + 1e-6)

/**
 * `AutoLevel`: the loudest the speaker has recently been reads as full and the room as silent, so a
 * quiet microphone and a loud one move the scope alike.
 */
export class AutoLevel {
  peak = -30
  room = -55
  step(db0: number, h: number) {
    const db = Math.max(db0, -120)
    const follow = (value: number, target: number, time: number) =>
      value + (target - value) * (1 - Math.exp(-h / Math.max(time, 1e-3)))
    this.room = follow(this.room, db, db < this.room ? 0.3 : 6)
    const lowest = Math.max(this.room, T.noiseFloor) + 16
    this.peak = db > this.peak ? follow(this.peak, db, 0.04) : follow(this.peak, lowest, T.autoRelease)
    this.peak = Math.max(this.peak, lowest)
    const low = Math.max(Math.max(this.room, T.noiseFloor) + 5, this.peak - 24)
    return clamp((db - low) / Math.max(this.peak - low, 1), 0, 1)
  }
}

/** Duration + bounce spring, solved analytically (`spring.rs`). */
class Spring {
  v = 0
  target: number
  constructor(public x: number) {
    this.target = x
  }
  jump(x: number) {
    this.x = x
    this.v = 0
    this.target = x
  }
  stepTo(target: number, duration: number, bounce: number, dt: number) {
    this.target = target
    const omega = TAU / Math.max(duration, 0.01)
    const zeta = bounce >= 0 ? Math.max(1 - bounce, 0) : 1 / Math.max(1 + bounce, 0.01)
    const x0 = this.x - target
    const v0 = this.v
    if (zeta < 1 - 1e-4) {
      const decay = zeta * omega
      const od = omega * Math.sqrt(1 - zeta * zeta)
      const e = Math.exp(-decay * dt)
      const sin = Math.sin(od * dt),
        cos = Math.cos(od * dt)
      const sd = sin / od
      this.x = target + e * (x0 * (cos + decay * sd) + v0 * sd)
      this.v = e * (-x0 * omega * omega * sd + v0 * (cos - decay * sd))
      return
    }
    const e = Math.exp(-omega * dt)
    const c = v0 + omega * x0
    this.x = target + (x0 + c * dt) * e
    this.v = (v0 - omega * c * dt) * e
  }
}

class Voice {
  level = 0
  reservoir = 0
  energy = 0
  kick = 0
  kickVelocity = 0
  band = 0
  step(raw: number, h: number) {
    const previous = this.level
    this.level += (raw - this.level) * (1 - Math.exp(-h / (raw > this.level ? 0.035 : 0.095)))
    const rise = Math.max((this.level - previous) / h, 0)
    this.reservoir += (1.75 * this.level * this.level - this.reservoir / 1.8) * h
    this.energy = 1 - Math.exp(-this.reservoir * 1.45)
    const w = TAU * 1.3
    this.kickVelocity += (-w * w * this.kick - 2 * 0.22 * w * this.kickVelocity + 15 * rise + 2.2 * this.level) * h
    this.kick += this.kickVelocity * h
    this.band += (raw - this.band) * (1 - Math.exp(-h / (raw > this.band ? 0.025 : 0.14)))
  }
}

class Trace {
  envelope = 0
  amplitude = 0
  amplitudeVelocity = 0
  glowFast = 0
  glowSpring = 0
  glowSpringVelocity = 0
  glowSlow = 0
  glow = 0
  history = new Float32Array(HISTORY * 5)
  head = 0
  constructor(public phases: number[]) {}

  tick(voice: Voice, live: number, speed: number, h: number) {
    const follow = (value: number, target: number, rise: number, fall: number) =>
      value + (target - value) * (1 - Math.exp(-h / (target > value ? rise : fall)))
    this.envelope = follow(this.envelope, voice.level, 0.022, T.release)
    const w = TAU * T.response
    this.amplitudeVelocity += (-w * w * (this.amplitude - this.envelope) - 2 * 0.52 * w * this.amplitudeVelocity) * h
    this.amplitude += this.amplitudeVelocity * h
    this.glowFast = follow(this.glowFast, voice.level, 0.045, 0.13)
    const gw = TAU * 3.6
    this.glowSpringVelocity +=
      (-gw * gw * (this.glowSpring - this.glowFast) - 2 * 0.5 * gw * this.glowSpringVelocity) * h
    this.glowSpring += this.glowSpringVelocity * h
    this.glowSlow = follow(this.glowSlow, voice.level, 0.15, 0.7)
    const swell = 0.8 * Math.max(this.glowSpring - 0.25, 0) + 0.04 * Math.max(voice.kick, -0.5)
    this.glow = Math.min(Math.max(swell, 0) + 0.42 * this.glowSlow + 0.2 * voice.energy, 1.15) * live
    const go = 0.6 + 1.1 * Math.min(this.envelope * 1.6, 1)
    for (let i = 0; i < 4; i++) this.phases[i] = (this.phases[i] + h * TAU * SPEEDS[i] * go * speed) % TAU
    const emphasis = 0.35 + 0.65 * Math.min(voice.band / (voice.band + 0.06), 2)
    const offset = this.head * 5
    const amplitude = Math.max(this.amplitude, 0) * live
    this.history[offset] = amplitude
    for (let c = 0; c < 4; c++) this.history[offset + 1 + c] = amplitude * BASE[c] * emphasis
    this.head = (this.head + 1) % HISTORY
  }

  past(delay: number, channel: number) {
    const d = Math.min(delay / STEP, HISTORY - 2)
    const i = Math.floor(d)
    const k = d - i
    const a = (this.head + 2 * HISTORY - 1 - i) % HISTORY
    const b = (a + HISTORY - 1) % HISTORY
    return this.history[a * 5 + channel] * (1 - k) + this.history[b * 5 + channel] * k
  }
}

/** The Dot scope simulation (`Scope`), with Hex's Flow processing look. */
export class Scope {
  stage: ScopeStage = "recording"
  private elapsed = 0
  private speedAtDone = 0
  private doneFrom = 0
  private flowOffset = 0
  private flowTurn = 0
  private auto = new AutoLevel()
  private voices = [new Voice(), new Voice()]
  private traces = [new Trace([0.1, 1.7, 3.3, 4.6]), new Trace([2.4, 0.6, 5.1, 1.9])]
  live = 0
  private carrier = 0
  private time = 0
  private steps = 0
  private pending = 0
  reduceMotion = false
  readonly columns = T.columns
  readonly rows = T.rows
  private head = [new Float32Array(T.columns * T.rows), new Float32Array(T.columns * T.rows)]
  private tail = [new Float32Array(T.columns * T.rows), new Float32Array(T.columns * T.rows)]
  /** Each dot's (brightness, freshness), row by row. */
  readonly dots = new Float32Array(T.columns * T.rows * 2)
  private ys = [new Float32Array((T.columns - 1) * SUB + 1), new Float32Array((T.columns - 1) * SUB + 1)]
  private brightness = [new Float32Array((T.columns - 1) * SUB + 1), new Float32Array((T.columns - 1) * SUB + 1)]
  grid = 0
  width = new Spring(START_WIDTH)
  opacity = new Spring(0)
  scale = new Spring(HIDDEN_SCALE)
  softness = new Spring(HIDDEN_SOFTNESS)
  cool = new Spring(0)
  fail = new Spring(0)

  /** Starts from nothing: the scanner unfolds the trace again. The auto level remembers the speaker. */
  restart() {
    const auto = this.auto
    Object.assign(this, new Scope())
    this.auto = auto
  }

  get glow() {
    return ((this.traces[0].glow + this.traces[1].glow) / 2) * T.glow
  }

  get settled() {
    return this.opacity.target === 0 && this.opacity.x < 0.002
  }

  advance(dt: number, stage: ScopeStage, visible: boolean, db: number, reduceMotion: boolean) {
    if (stage !== this.stage) {
      if (stage === "done") {
        this.speedAtDone = 1.5 * this.pulseSpeed()
        this.doneFrom = this.stage === "processing" ? this.elapsed : 0
      }
      if (stage === "processing") this.flowOffset = -this.width.x / 2 - 4
      this.stage = stage
      this.elapsed = 0
    }
    this.reduceMotion = reduceMotion
    this.pending += clamp(dt, 0, 0.25)
    while (this.pending >= STEP) {
      this.pending -= STEP
      this.step(visible, db)
    }
  }

  private voiced() {
    return this.stage === "recording" || this.stage === "speaking"
  }

  private step(visible: boolean, db: number) {
    const h = STEP
    const recording = this.voiced() && visible
    const level = recording ? clamp(this.auto.step(db, h) * T.gain, 0, 1) : 0
    this.voices[0].step(level, h)
    this.voices[1].step(level * 0.85, h)
    this.live += ((recording ? 1 : 0) - this.live) * (1 - Math.exp(-h / 0.55))
    const speed = this.reduceMotion ? 0 : T.braidSpeed
    this.traces[0].tick(this.voices[0], this.live, speed, h)
    this.traces[1].tick(this.voices[1], this.live, speed, h)
    const energy = Math.max(this.voices[0].energy, this.voices[1].energy)
    const working = this.stage === "processing" || this.stage === "done"
    this.flowTurn += ((working ? 1 : 0) - this.flowTurn) * (1 - Math.exp(-h / 0.25))
    if (working) this.flowOffset += this.flowSpeed() * h
    const rest = CARRIER_REST + 0.22 * energy
    const turn = rest + (this.flowTurnHz() - rest) * this.flowTurn
    this.carrier = (this.carrier + h * TAU * turn * speed) % TAU

    const width = this.voiced()
      ? T.width
      : this.stage === "failed"
        ? Math.max(this.width.target, T.processingWidth)
        : T.processingWidth
    const cool = this.stage === "recording" ? 0 : this.stage === "failed" ? this.cool.target : 1
    const fail = this.stage === "failed" ? 1 : 0
    const shown = visible ? 1 : 0
    if (this.reduceMotion) {
      this.width.jump(width)
      this.scale.jump(1)
      this.softness.jump(0)
      this.opacity.stepTo(shown, 0.16, 0, h)
      this.cool.stepTo(cool, 0.16, 0, h)
      this.fail.stepTo(fail, 0.16, 0, h)
    } else {
      this.width.stepTo(width, T.transition, T.bounce, h)
      // Hiding is quicker than showing: the pill gets out of the way when voice mode pauses.
      this.opacity.stepTo(shown, visible ? T.transition : 0.15, 0, h)
      this.scale.stepTo(visible ? 1 : HIDDEN_SCALE, T.transition, T.bounce, h)
      this.softness.stepTo(visible ? 0 : HIDDEN_SOFTNESS, T.transition, 0, h)
      this.cool.stepTo(cool, T.transition, 0, h)
      this.fail.stepTo(fail, T.transition, 0, h)
    }
    this.elapsed += h
    this.time += h
    this.steps += 1
    if (this.steps % 2 === 0) this.beam(2 * h)
  }

  private workPeriod() {
    return 2 * Math.max(T.shimmerPass, 0.05)
  }
  private flowSpacing() {
    return FLOW_SPACING * T.processingWidth
  }
  private flowSpeed() {
    return this.flowSpacing() / this.workPeriod()
  }
  private flowTurnHz() {
    return (this.flowSpeed() * T.helixCycles) / Math.max(this.width.x, 1)
  }
  private pulseSpeed() {
    return (T.processingWidth / 2 + 12) / (1.4 * this.workPeriod())
  }
  private flowLight(x: number, offset: number) {
    const spacing = this.flowSpacing()
    return bump(mod(x - offset + spacing / 2, spacing) - spacing / 2, 7)
  }

  /** (amplitude, brightness, swell) at `x` for this instant's envelope (`Scan::at`). */
  private scanAt(x: number, width: number, out: number[]) {
    const e = this.elapsed
    const half = width / 2
    if (this.stage === "failed" || this.reduceMotion) {
      out[0] = 1
      out[1] = 1
      out[2] = 0
      return
    }
    if (this.voiced()) {
      const reach = (half + 12) * (0.5 - 0.5 * Math.cos(Math.PI * clamp(e / ENTER, 0, 1)))
      const head = 2.8 * (1 - smoothstep(0.08, ENTER, e))
      const unfold = smoothstep(0, 0.1, e)
      const d = Math.abs(x)
      const drawn = unfold * (1 - smoothstep(Math.max(reach - 14, 0), Math.max(reach, 0.001), d))
      const amplitude = drawn * (1 - smoothstep(Math.max(reach - 22, 0), Math.max(reach - 3, 0.001), d))
      out[0] = amplitude
      out[1] = amplitude + head * bump(d - reach, 6)
      out[2] = 1.8 * unfold * (head / 2.8) * bump(d - Math.max(reach - 14, 0), 14)
      return
    }
    if (this.stage === "processing") {
      const enter = smoothstep(0, 0.35, e)
      const light = this.flowLight(x, this.flowOffset)
      out[0] = 1
      out[1] = 1 + 2.5 * smoothstep(0.05, 0.3, e) * T.shimmer * light
      out[2] = 0.9 * enter * light
      return
    }
    // Done: a front clears the field from the middle out as it collapses.
    const target = half + 8
    const t = clamp(e / WIPE, 0, 1)
    const t2 = t * t,
      t3 = t2 * t
    const front = (t3 - 2 * t2 + t) * WIPE * this.speedAtDone + (3 * t2 - 2 * t3) * target
    const headD = 2.8 * smoothstep(0, 0.04, e) * (1 - smoothstep(0.22, 0.32, e))
    const glow = 2.5 * T.shimmer * (1 - smoothstep(0, 0.18, e))
    const d = Math.abs(x)
    const keep = smoothstep(front - 12, front - 2, d)
    const light = this.flowLight(x, this.flowOffset)
    out[0] = keep
    out[1] = keep * (1 + glow * light) + headD * bump(d - front, 6)
    out[2] = keep * 0.9 * light
  }

  /** Draws both traces into the dot field and decays the phosphor (`Scope::beam`). */
  private beam(hb: number) {
    const columns = this.columns,
      rows = this.rows
    const samples = (columns - 1) * SUB + 1
    const pitch = T.spacing
    const width = Math.max(this.width.x, T.height)
    const e = this.elapsed
    const voiced = this.voiced()
    const working = this.stage === "processing"
    const done = this.stage === "done"
    const still = this.stage === "failed" || this.reduceMotion
    const helixScale = still ? 1 : voiced ? 1 : working ? 1 + (WORK_HELIX - 1) * smoothstep(0, 0.35, e) : WORK_HELIX
    const decay = done && !still ? 1 - 0.6 * smoothstep(0, 0.12, e) : 1
    const tailScale = done && !still ? 1 - smoothstep(0, 0.15, e) : 1
    this.grid = still ? 1 : voiced ? Math.min(e / 0.3, 1) : done ? 1 - smoothstep(0.2, 0.4, e) : 1
    const mid = (rows - 1) / 2
    const half = mid - 0.55
    const breath = this.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin((this.time * TAU) / BREATH_PERIOD)
    const rest = (0.55 + 0.35 * breath) * (0.4 + 0.6 * this.live) * helixScale
    const halfWidth = width / 2
    const scan = [0, 0, 0]
    for (let k = 0; k < 2; k++) {
      const trace = this.traces[k]
      const sign = k === 0 ? 1 : -1
      const ys = this.ys[k]
      const brightness = this.brightness[k]
      for (let s = 0; s < samples; s++) {
        const x = (s / SUB - (columns - 1) / 2) * pitch
        if (Math.abs(x) > halfWidth) {
          ys[s] = mid
          brightness[s] = 0
          continue
        }
        this.scanAt(x, width, scan)
        const amplitude = scan[0],
          bright = scan[1],
          swell = scan[2]
        const own = Math.abs(x)
        const xn = (x + halfWidth) / width
        const ends = Math.min(
          smoothstep(-halfWidth + 3, -halfWidth + 17, x),
          smoothstep(-halfWidth + 3, -halfWidth + 17, -x),
        )
        const reach = 1 - 0.8 * smoothstep(14, halfWidth, own)
        const delay = own / T.historySpeed
        const a = trace.past(delay, 0)
        let spread = 0
        for (let c = 0; c < 4; c++)
          spread += trace.past(delay, 1 + c) * Math.sin(TAU * SPATIAL[c] * xn - trace.phases[c])
        const helix = (rest + swell + half * 0.55 * a * reach) * Math.sin(TAU * T.helixCycles * xn - this.carrier)
        const y = half * Math.tanh((helix + half * 0.7 * spread * reach) / half) * ends * amplitude
        ys[s] = mid - sign * y
        const spatial = (0.3 + 0.7 * Math.min(a * 1.8, 1)) * (0.45 + 0.55 * ends)
        brightness[s] = spatial * amplitude + 0.36 * Math.max(bright - amplitude, 0)
      }
      for (let s = 0; s < samples; s++) {
        const slope = ((ys[Math.min(s + 1, samples - 1)] - ys[Math.max(s - 1, 0)]) * SUB) / 2
        brightness[s] *= 1 - 0.55 + 0.55 / Math.sqrt(1 + 0.22 * slope * slope)
      }
    }

    const headKeep = Math.exp(-hb / (PHOSPHOR_HEAD * decay))
    const tailKeep = Math.exp(-hb / (T.phosphor * decay))
    const dx = 1 / SUB
    for (let i = 0; i < columns; i++) {
      const s0 = Math.max(i - 3, 0) * SUB
      const s1 = Math.min((i + 3) * SUB, samples - 1)
      for (let j = 0; j < rows; j++) {
        const n = j * columns + i
        let now = 0,
          total = 0
        const lit = [0, 0]
        for (let k = 0; k < 2; k++) {
          const ys = this.ys[k]
          let best = Infinity
          let nearest = i * SUB
          for (let s = s0; s < s1; s++) {
            const ay = ys[s]
            const dy = ys[s + 1] - ay
            const px = i - s * dx
            const py = j - ay
            const t = clamp((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1)
            const ex = px - t * dx
            const ey = py - t * dy
            const d2 = ex * ex + ey * ey
            if (d2 < best) {
              best = d2
              nearest = s
            }
          }
          const b = this.brightness[k][nearest]
          const onBeam = Math.exp(-best / 0.25)
          const instant = Math.min(onBeam + 0.5 * Math.exp(-Math.sqrt(best) / 0.8), 1.2) * b
          const core = onBeam * b
          const head = Math.max(this.head[k][n] * headKeep, core)
          this.head[k][n] = head
          const tail = Math.max(this.tail[k][n] * tailKeep, core)
          this.tail[k][n] = tail
          const light = Math.max(instant, head, 0.55 * tailScale * tail)
          lit[k] = light
          now += instant
          total += light
        }
        const power = 1 - (1 - Math.min(lit[0], 1)) * (1 - Math.min(lit[1], 1))
        this.dots[n * 2] = clamp(power, 0, 1)
        this.dots[n * 2 + 1] = Math.min(now / Math.max(total, 1e-4), 1)
      }
    }
  }
}

/**
 * The site's pill is always dark, in both themes: a near-black plate with a faint lighter keyline,
 * and the waves drawn as white dots whose opacity carries the level (quiet dots about 15–25%, the
 * wave up to full). `dark` only changes the shadow under it.
 */
function palette(dark: boolean) {
  return {
    base: [1, 1, 1],
    core: [1, 1, 1],
    plate: [15, 15, 15, 1],
    rim: "rgba(255,255,255,0.14)",
    shadow: dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.18)",
  }
}

/** Draws a `Scope` at `zoom` times Hex's point size, centred in the canvas. */
export function drawScope(canvas: HTMLCanvasElement, scope: Scope, dark: boolean, zoom: number) {
  const ctx = canvas.getContext("2d")!
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const opacity = clamp(scope.opacity.x, 0, 1)
  if (opacity < 0.002) return
  const scale = Math.max(scope.scale.x, 0.01) * zoom
  ctx.translate(w / 2, h / 2)
  ctx.scale(scale, scale)
  ctx.globalAlpha = opacity
  const width = Math.max(scope.width.x, T.height)
  const height = T.height
  const radius = height / 2
  const soft = clamp(scope.softness.x, 0, HIDDEN_SOFTNESS)
  const p = palette(dark)

  ctx.save()
  ctx.shadowColor = p.shadow
  ctx.shadowBlur = 13 * scale * dpr * 0.5
  ctx.shadowOffsetY = 3 * scale
  ctx.filter = soft > 0.05 ? `blur(${soft * 0.72}px)` : "none"
  ctx.fillStyle = `rgba(${p.plate[0]},${p.plate[1]},${p.plate[2]},${p.plate[3]})`
  ctx.beginPath()
  ctx.roundRect(-width / 2, -height / 2, width, height, radius)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = p.rim
  // 1 CSS px whatever the zoom.
  ctx.lineWidth = 1 / scale
  ctx.beginPath()
  ctx.roundRect(-width / 2, -height / 2, width, height, radius)
  ctx.stroke()

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(-width / 2, -height / 2, width, height, radius)
  ctx.clip()
  const glow = scope.glow
  if (glow > 0.01) {
    const reach = 34 + 20 * glow
    const strength = 0.16 * Math.min(1, glow)
    const middle = p.base.map((v, i) => (v + p.core[i]) / 2)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, reach)
    g.addColorStop(0, rgba(middle, strength))
    g.addColorStop(1, rgba(p.base, 0))
    ctx.fillStyle = g
    ctx.fillRect(-reach, -reach, reach * 2, reach * 2)
  }
  const cols = scope.columns,
    rows = scope.rows
  const pitch = T.spacing
  const ox = (cols - 1) / 2,
    oy = (rows - 1) / 2
  const unlit = 0.25
  const full = 1
  const curve = 0.9
  const presence = 0.5 + 0.5 * Math.max(scope.live, scope.cool.x)
  const halfW = width / 2,
    halfH = height / 2
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = (i - ox) * pitch
      const cy = (j - oy) * pitch
      // How far inside the plate the dot sits (`rounded_box`), so dots fade out at the ends.
      const qx = Math.abs(cx) - halfW + radius
      const qy = Math.abs(cy) - halfH + radius
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
      const mask = smoothstep(1.4, 4.6, -dist)
      if (mask <= 0) continue
      const n = j * cols + i
      const power = Math.max(scope.dots[n * 2], 1e-5)
      const fresh = scope.dots[n * 2 + 1]
      const row = Math.abs(cy) / halfH
      const floorAlpha = unlit * (1 - 0.4 * smoothstep(0.35, 0.95, row)) * presence * scope.grid
      const alpha = floorAlpha + (full - floorAlpha) * Math.pow(power, curve * (1.4 + (1 - 1.4) * fresh))
      const dotR =
        (0.25 + 0.17 * Math.pow(power, 0.6)) * (1 + (0.82 + 0.18 * fresh - 1) * smoothstep(0.03, 0.2, power)) * pitch
      const coreT = clamp(power * power * 1.1, 0, 0.9) * (0.3 + 0.7 * fresh)
      const color = p.base.map((v, k) => v + (p.core[k] - v) * coreT)
      if (power > 0.05) {
        ctx.fillStyle = rgba(color, 0.132 * power * power * mask)
        ctx.beginPath()
        ctx.arc(cx, cy, dotR * 2, 0, TAU)
        ctx.fill()
      }
      ctx.fillStyle = rgba(color, alpha * mask)
      ctx.beginPath()
      ctx.arc(cx, cy, dotR, 0, TAU)
      ctx.fill()
    }
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

function rgba(c: number[], a: number) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${clamp(a, 0, 1)})`
}
