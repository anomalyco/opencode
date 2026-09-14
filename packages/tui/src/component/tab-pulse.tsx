import { OptimizedBuffer, Renderable, RGBA, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"

type TabPulseOptions = RenderableOptions<TabPulseRenderable> & {
  edge?: "above" | "below"
  enabled?: boolean
  active?: boolean
  outerActive?: boolean
  promptPulse?: number
  outerPromptPulse?: number
  complete?: boolean
  outerComplete?: boolean
  glow?: boolean
  outerGlow?: boolean
  color?: RGBA
  outerColor?: RGBA
  glowColor?: RGBA
  outerGlowColor?: RGBA
  glowTail?: number
  outerGlowTail?: number
  flashColor?: RGBA
  outerFlashColor?: RGBA
  flashTail?: number
  outerFlashTail?: number
  completionColor?: RGBA
  outerCompletionColor?: RGBA
  backgroundColor?: RGBA
  /** Reports the running sweep's intensity at the tab number's cell, quantized; 0 when idle. */
  onLevel?: (level: number) => void
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
export const smootherstep = (value: number) => value * value * value * (value * (value * 6 - 15) + 10)
const RUN_DURATION = 2_800
const RUN_ATTACK = 450
const RUN_HEAD = 4
const RUN_TAIL = 18
const RUN_FADE_OUT = 500
const COMPLETION_DURATION = 1_200
const COMPLETION_ATTACK = 0.12
const COMPLETION_OPACITY = 0.18
const EDGE_FLASH_DURATION = 800
const EDGE_FLASH_ATTACK = 0.1
const EDGE_FLASH_OPACITY = 0.1
const PROMPT_FLASH_SCALE = 2
const GLOW_IGNITION_DURATION = 600
const GLOW_IGNITION_PEAK = 1.5
const GLOW_IGNITION_ATTACK = 0.3
const GLOW_FADE_OUT = 200
const GLOW_RELEASE_DURATION = 900
const GLOW_RELEASE_ATTACK = 0.12
const GLOW_RELEASE_PEAK = 1.25
const GLOW_TAIL = 12
const GLOW_OPACITY = 0.16
const DEFAULT_FOREGROUND = RGBA.defaultForeground()
export const intensityAt = (index: number, front: number, head: number, tail: number) => {
  const distance = front - index
  return distance < 0 ? smootherstep(clamp(1 + distance / head)) : smootherstep(clamp(1 - distance / tail))
}
export const coast = (value: number) => {
  const ramp = 0.2
  if (value < ramp) return (value * value) / (2 * ramp * (1 - ramp))
  if (value > 1 - ramp) return 1 - ((1 - value) * (1 - value)) / (2 * ramp * (1 - ramp))
  return (value - ramp / 2) / (1 - ramp)
}
const fadeOut = (progress: number) => 1 - smootherstep(progress)
/** Rise to peak over the attack fraction, then settle to rest over the remainder. */
const attackDecay = (progress: number, attack: number, peak: number, rest: number) =>
  progress < attack
    ? peak * smootherstep(clamp(progress / attack))
    : peak - (peak - rest) * smootherstep(clamp((progress - attack) / (1 - attack)))
export const completionPulseOpacity = (progress: number) => attackDecay(progress, COMPLETION_ATTACK, 1, 0)
export const glowIgnitionLevel = (progress: number) =>
  attackDecay(progress, GLOW_IGNITION_ATTACK, GLOW_IGNITION_PEAK, 1)
const glowIntensityAt = (index: number, tail: number) => smootherstep(clamp(1 - Math.max(0, index - 1) / tail))
export const tabFlashIntensity = (index: number, tail: number) => glowIntensityAt(index, tail)
export const unreadGlowIntensity = (index: number, width: number, maximumTail = GLOW_TAIL) => {
  const tail = Math.min(maximumTail, Math.max(1, width - 2))
  return glowIntensityAt(index, tail)
}
/** How far a resolving glow has diffused: the resting tail spreads across the full width as it thins away. */
const glowReleaseSpread = (progress: number, tail: number, width: number) => tail + smootherstep(progress) * width
// The resting glow drains away over this leading fraction of the release, i.e. the old 200ms fade.
const GLOW_RELEASE_DRAIN_FRACTION = GLOW_FADE_OUT / GLOW_RELEASE_DURATION
const glowReleaseDrain = (progress: number) => fadeOut(clamp(progress / GLOW_RELEASE_DRAIN_FRACTION))
/** The diffusing glow swells gently above its resting level, then decays to nothing. */
const glowReleaseSwell = (progress: number) => attackDecay(progress, GLOW_RELEASE_ATTACK, GLOW_RELEASE_PEAK, 0)
export function blendTabPulseColor(
  output: RGBA,
  background: RGBA,
  glowColor: RGBA,
  runningColor: RGBA,
  flashColor: RGBA,
  completionColor: RGBA,
  glow: number,
  running: number,
  flash: number,
  completion: number,
) {
  if (glow === 0) {
    output.r = background.r
    output.g = background.g
    output.b = background.b
  } else {
    output.r = background.r + (glowColor.r - background.r) * glow
    output.g = background.g + (glowColor.g - background.g) * glow
    output.b = background.b + (glowColor.b - background.b) * glow
  }
  if (running !== 0) {
    output.r += (runningColor.r - output.r) * running
    output.g += (runningColor.g - output.g) * running
    output.b += (runningColor.b - output.b) * running
  }
  if (flash !== 0) {
    output.r += (flashColor.r - output.r) * flash
    output.g += (flashColor.g - output.g) * flash
    output.b += (flashColor.b - output.b) * flash
  }
  if (completion !== 0) {
    output.r += (completionColor.r - output.r) * completion
    output.g += (completionColor.g - output.g) * completion
    output.b += (completionColor.b - output.b) * completion
  }
}

/** A one-shot animation clock: level() follows shape over duration, scaled by the value passed to start. */
class Envelope {
  private clock: number | undefined
  private scale = 1

  constructor(
    private duration: number,
    private shape: (progress: number) => number,
  ) {}

  start(scale = 1) {
    if (this.clock !== undefined) return
    this.clock = 0
    this.scale = scale
  }

  restart(scale = 1) {
    this.clock = 0
    this.scale = scale
  }

  stop() {
    this.clock = undefined
  }

  advance(delta: number) {
    if (this.clock === undefined) return
    this.clock += delta
    if (this.clock >= this.duration) this.clock = undefined
  }

  get active() {
    return this.clock !== undefined
  }

  level() {
    return this.clock === undefined ? 0 : this.scale * this.shape(this.clock / this.duration)
  }
}

type GateStage = {
  duration: number
  shape: (progress: number) => number
}

/**
 * A gated animation stage, in the synthesizer sense: trigger runs the attack shape and holds
 * sustain at 1; release fades out from whatever level the stage had at note-off. Sustain is
 * motionless, so only the attack and release phases count as animating.
 */
class GatedEnvelope {
  private phase: "idle" | "attack" | "sustain" | "release"
  private phaseClock = 0
  // Level captured at note-off; only meaningful while releasing.
  private releaseScale = 1

  constructor(
    private attackStage: GateStage,
    private releaseStage: GateStage,
    initial: "idle" | "sustain" = "idle",
  ) {
    this.phase = initial
  }

  /** Note-on: run the attack from silence and hold sustain. */
  trigger() {
    this.phase = "attack"
    this.phaseClock = 0
  }

  /** Note-off: fade out from the current level. */
  release() {
    if (this.phase === "idle") return
    this.releaseScale = this.level
    this.phase = "release"
    this.phaseClock = 0
  }

  /** Halt mid-motion without a fade, e.g. when animations are disabled. */
  settle(phase: "idle" | "sustain") {
    this.phase = phase
    this.phaseClock = 0
  }

  advance(delta: number) {
    if (this.phase === "idle" || this.phase === "sustain") return
    this.phaseClock += delta
    const duration = this.phase === "attack" ? this.attackStage.duration : this.releaseStage.duration
    if (this.phaseClock < duration) return
    this.phase = this.phase === "attack" ? "sustain" : "idle"
    this.phaseClock = 0
  }

  get level() {
    if (this.phase === "idle") return 0
    if (this.phase === "sustain") return 1
    if (this.phase === "attack") return this.attackStage.shape(this.phaseClock / this.attackStage.duration)
    return this.releaseScale * this.releaseStage.shape(this.phaseClock / this.releaseStage.duration)
  }

  get animating() {
    return this.phase === "attack" || this.phase === "release"
  }

  get idle() {
    return this.phase === "idle"
  }

  get releaseProgress() {
    return this.phase === "release" ? this.phaseClock / this.releaseStage.duration : undefined
  }

  get noteOffLevel() {
    return this.releaseScale
  }
}

type PulseStateOptions = {
  enabled: boolean
  active: boolean
  promptPulse: number
  complete: boolean
  glow: boolean
}

class PulseState {
  private enabled: boolean
  private active: boolean
  private promptPulse: number
  private complete: boolean
  private glow: boolean
  private completionPending = false
  private sweepClock = 0
  // Two gated voices: the running sweep and the unread glow. One-shots handle flash and completion.
  private runEnvelope = new GatedEnvelope(
    { duration: RUN_ATTACK, shape: smootherstep },
    { duration: RUN_FADE_OUT, shape: fadeOut },
  )
  private glowEnvelope: GatedEnvelope
  private completionPulse = new Envelope(COMPLETION_DURATION, completionPulseOpacity)
  private edgeFlash = new Envelope(EDGE_FLASH_DURATION, (progress) => attackDecay(progress, EDGE_FLASH_ATTACK, 1, 0))

  constructor(options: PulseStateOptions) {
    this.enabled = options.enabled
    this.active = options.active
    this.promptPulse = options.promptPulse
    this.complete = options.complete
    this.glow = options.glow
    // A glow that exists at mount holds sustain without an ignition flash, even when animations are off.
    this.glowEnvelope = new GatedEnvelope(
      { duration: GLOW_IGNITION_DURATION, shape: glowIgnitionLevel },
      { duration: GLOW_RELEASE_DURATION, shape: glowReleaseDrain },
      options.glow ? "sustain" : "idle",
    )
    if (this.enabled && this.active) this.runEnvelope.trigger()
  }

  get live() {
    return (
      this.enabled &&
      (this.active ||
        this.runEnvelope.animating ||
        this.glowEnvelope.animating ||
        this.completionPulse.active ||
        this.edgeFlash.active)
    )
  }

  get running() {
    return this.runEnvelope.level
  }

  get completion() {
    return this.completionPulse.level() * COMPLETION_OPACITY
  }

  get flash() {
    return this.edgeFlash.level() * EDGE_FLASH_OPACITY
  }

  /** The resting glow's amplitude: ignition attack, sustain, or the draining note-off residue. */
  get glowLevel() {
    return this.glowEnvelope.level
  }

  get glowReleaseProgress() {
    return this.glowEnvelope.releaseProgress
  }

  /** The diffusing swell's amplitude; it rides above the glow it released from, never below its resting level. */
  get glowReleaseSwell() {
    const progress = this.glowEnvelope.releaseProgress
    if (progress === undefined) return 0
    return glowReleaseSwell(progress) * Math.max(1, this.glowEnvelope.noteOffLevel)
  }

  setEnabled(value: boolean) {
    if (value === this.enabled) return false
    this.enabled = value
    if (!value) {
      this.runEnvelope.settle("idle")
      this.glowEnvelope.settle(this.glow ? "sustain" : "idle")
      this.completionPulse.stop()
      this.edgeFlash.stop()
      this.completionPending = false
    } else if (this.active) {
      // Re-enable resumes the sweep from its prior position, so no sweep clock reset here.
      this.runEnvelope.trigger()
    }
    return true
  }

  setActive(value: boolean) {
    if (value === this.active) return false
    this.active = value
    if (!this.enabled) return true
    if (value) {
      this.sweepClock = 0
      this.runEnvelope.trigger()
      this.completionPulse.stop()
      this.completionPending = false
    } else {
      this.runEnvelope.release()
      this.completionPending = true
    }
    this.edgeFlash.start()
    return true
  }

  setPromptPulse(value: number) {
    if (value === this.promptPulse) return false
    this.promptPulse = value
    if (this.enabled) this.edgeFlash.restart(PROMPT_FLASH_SCALE)
    return true
  }

  setComplete(value: boolean) {
    if (value === this.complete) return false
    this.complete = value
    if (!value) {
      this.completionPulse.stop()
      this.completionPending = false
    }
    if (value && this.completionPending) {
      this.completionPending = false
      if (this.enabled) this.completionPulse.start()
    }
    return true
  }

  setGlow(value: boolean) {
    if (value === this.glow) return false
    this.glow = value
    // Without animations the glow still holds statically; it just skips the ignition and release motion.
    if (!this.enabled) {
      this.glowEnvelope.settle(value ? "sustain" : "idle")
      return true
    }
    if (value) this.glowEnvelope.trigger()
    else this.glowEnvelope.release()
    return true
  }

  advance(deltaTime: number) {
    if (!this.live) return
    // The sweep keeps coasting from note-on through the release fade.
    if (!this.runEnvelope.idle) this.sweepClock += deltaTime
    this.runEnvelope.advance(deltaTime)
    this.glowEnvelope.advance(deltaTime)
    this.completionPulse.advance(deltaTime)
    this.edgeFlash.advance(deltaTime)
    if (!this.completionPending) return
    if (this.complete) {
      this.completionPending = false
      this.completionPulse.start()
      return
    }
    if (this.runEnvelope.releaseProgress === undefined) this.completionPending = false
  }

  // Scratch tuple reused across frames so the steady-state render allocates nothing.
  private sweepFronts: [number, number] = [0, 0]

  fronts(width: number) {
    const cycles = this.sweepClock / RUN_DURATION
    const progress = cycles % 1
    const start = -RUN_HEAD
    const end = width - 1 + RUN_TAIL
    const secondProgress = cycles < 0.5 ? 0 : (cycles + 0.5) % 1
    this.sweepFronts[0] = start + coast(progress) * (end - start)
    this.sweepFronts[1] = start + coast(secondProgress) * (end - start)
    return this.sweepFronts
  }
}

class TabPulseRenderable extends Renderable {
  private _enabled: boolean
  private inner: PulseState
  private outer: PulseState
  private _color: RGBA
  private _outerColor: RGBA
  private _glowColor: RGBA
  private _outerGlowColor: RGBA
  private _glowTail: number
  private _outerGlowTail: number
  private _edge: "above" | "below" | undefined
  private _flashColor: RGBA
  private _outerFlashColor: RGBA
  private _flashTail: number | undefined
  private _outerFlashTail: number | undefined
  private _completionColor: RGBA
  private _outerCompletionColor: RGBA
  private _backgroundColor: RGBA
  private renderColor = RGBA.fromInts(0, 0, 0)
  private outerRenderColor = RGBA.fromInts(0, 0, 0)
  private _onLevel: ((level: number) => void) | undefined
  private lastLevel = 0

  constructor(ctx: RenderContext, options: TabPulseOptions = {}) {
    const enabled = options.enabled ?? true
    const active = options.active ?? false
    const glow = options.glow ?? false
    const edge = options.edge
    const outerActive = options.outerActive ?? active
    const outerGlow = options.outerGlow ?? glow
    super(ctx, {
      ...options,
      height: 1,
      live: enabled && (active || (edge !== undefined && outerActive)),
    })
    this._enabled = enabled
    this.inner = new PulseState({
      enabled,
      active,
      promptPulse: options.promptPulse ?? 0,
      complete: options.complete ?? false,
      glow,
    })
    this.outer = new PulseState({
      enabled: enabled && edge !== undefined,
      active: outerActive,
      promptPulse: options.outerPromptPulse ?? options.promptPulse ?? 0,
      complete: options.outerComplete ?? options.complete ?? false,
      glow: outerGlow,
    })
    this._color = options.color ?? RGBA.defaultForeground()
    this._outerColor = options.outerColor ?? this._color
    this._glowColor = options.glowColor ?? this._color
    this._outerGlowColor = options.outerGlowColor ?? this._glowColor
    this._glowTail = options.glowTail ?? GLOW_TAIL
    this._outerGlowTail = options.outerGlowTail ?? this._glowTail
    this._edge = edge
    this._flashColor = options.flashColor ?? this._color
    this._outerFlashColor = options.outerFlashColor ?? options.flashColor ?? this._outerColor
    this._flashTail = options.flashTail
    this._outerFlashTail = options.outerFlashTail ?? options.flashTail
    this._completionColor = options.completionColor ?? this._color
    this._outerCompletionColor = options.outerCompletionColor ?? options.completionColor ?? this._outerColor
    this._backgroundColor = options.backgroundColor ?? RGBA.defaultBackground()
    this._onLevel = options.onLevel
  }

  set onLevel(value: ((level: number) => void) | undefined) {
    this._onLevel = value
  }

  private emitLevel(value: number) {
    if (!this._onLevel) return
    const quantized = Math.round(value * 32) / 32
    if (quantized === this.lastLevel) return
    this.lastLevel = quantized
    this._onLevel?.(quantized)
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    this.inner.setEnabled(value)
    this.outer.setEnabled(value && this._edge !== undefined)
    this.live = this.inner.live || this.outer.live
    this.requestRender()
  }

  set active(value: boolean) {
    if (this.inner.setActive(value)) this.changed()
  }

  set outerActive(value: boolean) {
    if (this.outer.setActive(value)) this.changed()
  }

  set promptPulse(value: number) {
    if (this.inner.setPromptPulse(value)) this.changed()
  }

  set outerPromptPulse(value: number) {
    if (this.outer.setPromptPulse(value)) this.changed()
  }

  set complete(value: boolean) {
    if (this.inner.setComplete(value)) this.changed()
  }

  set outerComplete(value: boolean) {
    if (this.outer.setComplete(value)) this.changed()
  }

  set glow(value: boolean) {
    if (this.inner.setGlow(value)) this.changed()
  }

  set outerGlow(value: boolean) {
    if (this.outer.setGlow(value)) this.changed()
  }

  private changed() {
    this.live = this.inner.live || this.outer.live
    this.requestRender()
  }

  set color(value: RGBA) {
    if (value.equals(this._color)) return
    this._color = value
    this.requestRender()
  }

  set glowColor(value: RGBA) {
    if (value.equals(this._glowColor)) return
    this._glowColor = value
    this.requestRender()
  }

  set outerColor(value: RGBA) {
    if (value.equals(this._outerColor)) return
    this._outerColor = value
    this.requestRender()
  }

  set outerGlowColor(value: RGBA) {
    if (value.equals(this._outerGlowColor)) return
    this._outerGlowColor = value
    this.requestRender()
  }

  set glowTail(value: number) {
    if (value === this._glowTail) return
    this._glowTail = value
    this.requestRender()
  }

  set outerGlowTail(value: number) {
    if (value === this._outerGlowTail) return
    this._outerGlowTail = value
    this.requestRender()
  }

  set edge(value: "above" | "below" | undefined) {
    if (value === this._edge) return
    this._edge = value
    this.outer.setEnabled(this._enabled && value !== undefined)
    this.live = this.inner.live || this.outer.live
    this.requestRender()
  }

  set flashColor(value: RGBA) {
    if (value.equals(this._flashColor)) return
    this._flashColor = value
    this.requestRender()
  }

  set outerFlashColor(value: RGBA) {
    if (value.equals(this._outerFlashColor)) return
    this._outerFlashColor = value
    this.requestRender()
  }

  set flashTail(value: number | undefined) {
    if (value === this._flashTail) return
    this._flashTail = value
    this.requestRender()
  }

  set outerFlashTail(value: number | undefined) {
    if (value === this._outerFlashTail) return
    this._outerFlashTail = value
    this.requestRender()
  }

  set completionColor(value: RGBA) {
    if (value.equals(this._completionColor)) return
    this._completionColor = value
    this.requestRender()
  }

  set outerCompletionColor(value: RGBA) {
    if (value.equals(this._outerCompletionColor)) return
    this._outerCompletionColor = value
    this.requestRender()
  }

  set backgroundColor(value: RGBA) {
    if (value.equals(this._backgroundColor)) return
    this._backgroundColor = value
    this.requestRender()
  }

  protected override onUpdate(deltaTime: number): void {
    if (!this.live) return
    this.inner.advance(deltaTime)
    this.outer.advance(deltaTime)
    this.live = this.inner.live || this.outer.live
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed || this.width <= 0) return
    const running = this.inner.running
    const completion = this.inner.completion
    const flash = this.inner.flash
    const glowLevel = this.inner.glowLevel
    const releaseProgress = this.inner.glowReleaseProgress
    const outerRunning = this.outer.running
    const outerCompletion = this.outer.completion
    const outerFlash = this.outer.flash
    const outerGlowLevel = this.outer.glowLevel
    const outerReleaseProgress = this.outer.glowReleaseProgress
    if (
      glowLevel === 0 &&
      releaseProgress === undefined &&
      running === 0 &&
      completion === 0 &&
      flash === 0 &&
      outerGlowLevel === 0 &&
      outerReleaseProgress === undefined &&
      outerRunning === 0 &&
      outerCompletion === 0 &&
      outerFlash === 0
    ) {
      this.emitLevel(0)
      return
    }
    const fronts = running === 0 ? undefined : this.inner.fronts(this.width)
    const outerFronts = outerRunning === 0 ? undefined : this.outer.fronts(this.width)
    if (this._onLevel)
      this.emitLevel(
        running === 0
          ? 0
          : Math.max(intensityAt(1, fronts![0], RUN_HEAD, RUN_TAIL), intensityAt(1, fronts![1], RUN_HEAD, RUN_TAIL)) *
              running,
      )
    const glowTail = Math.min(this._glowTail, Math.max(1, this.width - 2))
    const outerGlowTail = Math.min(this._outerGlowTail, Math.max(1, this.width - 2))
    const releaseSwell = this.inner.glowReleaseSwell
    const releaseSpread = releaseSwell === 0 ? 0 : glowReleaseSpread(releaseProgress!, glowTail, this.width)
    const outerReleaseSwell = this.outer.glowReleaseSwell
    const outerReleaseSpread =
      outerReleaseSwell === 0 ? 0 : glowReleaseSpread(outerReleaseProgress!, outerGlowTail, this.width)
    const flashTail = this._flashTail === undefined ? undefined : Math.min(this._flashTail, Math.max(1, this.width - 2))
    const outerFlashTail =
      this._outerFlashTail === undefined ? undefined : Math.min(this._outerFlashTail, Math.max(1, this.width - 2))
    for (let index = 0; index < this.width; index++) {
      // Skip per-cell sweep and glow math when that stage is idle, e.g. a steady breathing glow.
      const sweep =
        running === 0
          ? 0
          : Math.max(
              intensityAt(index, fronts![0], RUN_HEAD, RUN_TAIL),
              intensityAt(index, fronts![1], RUN_HEAD, RUN_TAIL),
            ) *
            0.14 *
            running
      const outerSweep =
        outerRunning === 0
          ? 0
          : Math.max(
              intensityAt(index, outerFronts![0], RUN_HEAD, RUN_TAIL),
              intensityAt(index, outerFronts![1], RUN_HEAD, RUN_TAIL),
            ) *
            0.14 *
            outerRunning
      blendTabPulseColor(
        this.renderColor,
        this._backgroundColor,
        this._glowColor,
        this._color,
        this._flashColor,
        this._completionColor,
        Math.max(
          glowLevel === 0 ? 0 : glowIntensityAt(index, glowTail) * GLOW_OPACITY * glowLevel,
          releaseSwell === 0 ? 0 : glowIntensityAt(index, releaseSpread) * GLOW_OPACITY * releaseSwell,
        ),
        sweep,
        flashTail === undefined ? flash : flash * tabFlashIntensity(index, flashTail),
        completion,
      )
      if (!this._edge) {
        buffer.setCell(this.screenX + index, this.screenY, " ", DEFAULT_FOREGROUND, this.renderColor)
        continue
      }
      blendTabPulseColor(
        this.outerRenderColor,
        this._backgroundColor,
        this._outerGlowColor,
        this._outerColor,
        this._outerFlashColor,
        this._outerCompletionColor,
        Math.max(
          outerGlowLevel === 0 ? 0 : glowIntensityAt(index, outerGlowTail) * GLOW_OPACITY * outerGlowLevel,
          outerReleaseSwell === 0 ? 0 : glowIntensityAt(index, outerReleaseSpread) * GLOW_OPACITY * outerReleaseSwell,
        ),
        outerSweep,
        outerFlashTail === undefined ? outerFlash : outerFlash * tabFlashIntensity(index, outerFlashTail),
        outerCompletion,
      )
      buffer.setCell(
        this.screenX + index,
        this.screenY,
        this._edge === "above" ? "▄" : "▀",
        this.renderColor,
        this.outerRenderColor,
      )
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    tab_pulse: typeof TabPulseRenderable
  }
}

extend({ tab_pulse: TabPulseRenderable })

export function TabPulse(props: {
  top?: number
  width?: number
  edge?: "above" | "below"
  enabled?: boolean
  active: boolean
  outerActive?: boolean
  promptPulse?: number
  outerPromptPulse?: number
  complete?: boolean
  outerComplete?: boolean
  glow?: boolean
  outerGlow?: boolean
  color: RGBA
  outerColor?: RGBA
  glowColor?: RGBA
  outerGlowColor?: RGBA
  glowTail?: number
  outerGlowTail?: number
  flashColor?: RGBA
  outerFlashColor?: RGBA
  flashTail?: number
  outerFlashTail?: number
  completionColor?: RGBA
  outerCompletionColor?: RGBA
  backgroundColor: RGBA
  onLevel?: (level: number) => void
}) {
  return (
    <tab_pulse
      position="absolute"
      top={props.top}
      edge={props.edge}
      zIndex={0}
      width={props.width ?? "100%"}
      enabled={props.enabled ?? true}
      active={props.active}
      outerActive={props.outerActive ?? props.active}
      promptPulse={props.promptPulse ?? 0}
      outerPromptPulse={props.outerPromptPulse ?? props.promptPulse ?? 0}
      complete={props.complete ?? false}
      outerComplete={props.outerComplete ?? props.complete ?? false}
      glow={props.glow ?? false}
      outerGlow={props.outerGlow ?? props.glow ?? false}
      color={props.color}
      outerColor={props.outerColor ?? props.color}
      glowColor={props.glowColor ?? props.color}
      outerGlowColor={props.outerGlowColor ?? props.glowColor ?? props.color}
      glowTail={props.glowTail ?? GLOW_TAIL}
      outerGlowTail={props.outerGlowTail ?? props.glowTail ?? GLOW_TAIL}
      flashColor={props.flashColor ?? props.color}
      outerFlashColor={props.outerFlashColor ?? props.flashColor ?? props.outerColor ?? props.color}
      flashTail={props.flashTail}
      outerFlashTail={props.outerFlashTail ?? props.flashTail}
      completionColor={props.completionColor ?? props.color}
      outerCompletionColor={props.outerCompletionColor ?? props.completionColor ?? props.outerColor ?? props.color}
      backgroundColor={props.backgroundColor}
      onLevel={props.onLevel}
    />
  )
}
