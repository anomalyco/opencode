import { OptimizedBuffer, Renderable, RGBA, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"

export type TabPulseState = {
  active?: boolean
  promptPulse?: number
  complete?: boolean
  glow?: boolean
  breathe?: boolean
}

export type TabPulseLayer = TabPulseState & {
  timeline?: TabPulseTimeline
  color: RGBA
  glowColor?: RGBA
  glowTail?: number
  flashColor?: RGBA
  completionColor?: RGBA
}

type TabPulseOptions = RenderableOptions<TabPulseRenderable> & {
  edge?: "above" | "below"
  enabled?: boolean
  layer?: TabPulseLayer
  edgeLayer?: TabPulseLayer
  backgroundColor?: RGBA
  /** Reports the running sweep's intensity at the tab number's cell, quantized; 0 when idle. */
  onLevel?: (level: number) => void
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smootherstep = (value: number) => value * value * value * (value * (value * 6 - 15) + 10)
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
const GLOW_BREATHE_PERIOD = 3_600
const GLOW_BREATHE_RISE = 0.25
const GLOW_TAIL = 12
const GLOW_OPACITY = 0.16
const DEFAULT_FOREGROUND = RGBA.defaultForeground()
const intensityAt = (index: number, front: number, head: number, tail: number) => {
  const distance = front - index
  return distance < 0 ? smootherstep(clamp(1 + distance / head)) : smootherstep(clamp(1 - distance / tail))
}
const coast = (value: number) => {
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
export const unreadGlowIntensity = (index: number, width: number, maximumTail = GLOW_TAIL) => {
  const tail = Math.min(maximumTail, Math.max(1, width - 2))
  return glowIntensityAt(index, tail)
}
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
  output.r = background.r + (glowColor.r - background.r) * glow
  output.g = background.g + (glowColor.g - background.g) * glow
  output.b = background.b + (glowColor.b - background.b) * glow
  output.r += (runningColor.r - output.r) * running
  output.g += (runningColor.g - output.g) * running
  output.b += (runningColor.b - output.b) * running
  output.r += (flashColor.r - output.r) * flash
  output.g += (flashColor.g - output.g) * flash
  output.b += (flashColor.b - output.b) * flash
  output.r += (completionColor.r - output.r) * completion
  output.g += (completionColor.g - output.g) * completion
  output.b += (completionColor.b - output.b) * completion
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

// Hoisted so the per-frame liveness check allocates no closure.
const envelopeActive = (envelope: Envelope) => envelope.active

type PulseStateOptions = {
  enabled: boolean
  active: boolean
  promptPulse: number
  complete: boolean
  glow: boolean
  breathe: boolean
}

class PulseState {
  private enabled: boolean
  private active: boolean
  private promptPulse: number
  private complete: boolean
  private glow: boolean
  private breathe: boolean
  private clock = 0
  private breatheClock = 0
  private completionPending = false
  private runAttack = new Envelope(RUN_ATTACK, smootherstep)
  private runFade = new Envelope(RUN_FADE_OUT, fadeOut)
  private completionPulse = new Envelope(COMPLETION_DURATION, completionPulseOpacity)
  private edgeFlash = new Envelope(EDGE_FLASH_DURATION, (progress) => attackDecay(progress, EDGE_FLASH_ATTACK, 1, 0))
  private ignition = new Envelope(GLOW_IGNITION_DURATION, glowIgnitionLevel)
  private glowOff = new Envelope(GLOW_FADE_OUT, fadeOut)
  private envelopes = [this.runAttack, this.runFade, this.completionPulse, this.edgeFlash, this.ignition, this.glowOff]

  constructor(options: PulseStateOptions) {
    this.enabled = options.enabled
    this.active = options.active
    this.promptPulse = options.promptPulse
    this.complete = options.complete
    this.glow = options.glow
    this.breathe = options.breathe
    if (this.enabled && this.active) this.runAttack.start()
  }

  private get breathing() {
    return this.enabled && this.glow && this.breathe
  }

  get live() {
    return this.active || this.breathing || this.envelopes.some(envelopeActive)
  }

  get running() {
    if (!this.enabled) return 0
    return this.active ? (this.runAttack.active ? this.runAttack.level() : 1) : this.runFade.level()
  }

  get completion() {
    return this.completionPulse.level() * COMPLETION_OPACITY
  }

  get flash() {
    return this.edgeFlash.level() * EDGE_FLASH_OPACITY
  }

  get glowLevel() {
    if (!this.glow) return this.glowOff.level()
    const base = this.ignition.active ? this.ignition.level() : 1
    if (!this.breathing) return base
    return (
      base * (1 + GLOW_BREATHE_RISE * 0.5 * (1 - Math.cos((2 * Math.PI * this.breatheClock) / GLOW_BREATHE_PERIOD)))
    )
  }

  setEnabled(value: boolean) {
    if (value === this.enabled) return false
    this.enabled = value
    if (!value) {
      for (const envelope of this.envelopes) envelope.stop()
      this.completionPending = false
      this.breatheClock = 0
    } else if (this.active) {
      this.runAttack.restart()
    }
    return true
  }

  setActive(value: boolean) {
    if (value === this.active) return false
    this.active = value
    if (!this.enabled) return true
    if (value) {
      this.clock = 0
      this.runAttack.restart()
      this.runFade.stop()
      this.completionPulse.stop()
      this.completionPending = false
    } else {
      const level = this.runAttack.active ? this.runAttack.level() : 1
      this.runAttack.stop()
      this.runFade.start(level)
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
    if (this.enabled && !value) this.glowOff.start(this.glowLevel)
    this.glow = value
    this.ignition.stop()
    this.breatheClock = 0
    if (this.enabled && value) {
      this.glowOff.stop()
      this.ignition.start()
    }
    return true
  }

  setBreathe(value: boolean) {
    if (value === this.breathe) return false
    this.breathe = value
    this.breatheClock = 0
    return true
  }

  advance(deltaTime: number) {
    if (!this.enabled) return
    if (this.active || this.runFade.active) this.clock += deltaTime
    if (this.breathing) this.breatheClock += deltaTime
    for (const envelope of this.envelopes) envelope.advance(deltaTime)
    if (!this.completionPending) return
    if (this.complete) {
      this.completionPending = false
      this.completionPulse.start()
      return
    }
    if (!this.runFade.active) this.completionPending = false
  }

  fronts(width: number) {
    const cycles = this.clock / RUN_DURATION
    const progress = cycles % 1
    const start = -RUN_HEAD
    const end = width - 1 + RUN_TAIL
    const secondProgress = cycles < 0.5 ? 0 : (cycles + 0.5) % 1
    return [start + coast(progress) * (end - start), start + coast(secondProgress) * (end - start)] as const
  }
}

export class TabPulseTimeline {
  private state: PulseState
  private frame = -1

  constructor(options: TabPulseState = {}, enabled = true) {
    this.state = new PulseState({
      enabled,
      active: options.active ?? false,
      promptPulse: options.promptPulse ?? 0,
      complete: options.complete ?? false,
      glow: options.glow ?? false,
      breathe: options.breathe ?? false,
    })
  }

  set(options: TabPulseState, enabled: boolean) {
    return [
      this.state.setEnabled(enabled),
      // Stopping a run arms completion; apply complete afterward so an atomic idle update can consume it.
      this.state.setActive(options.active ?? false),
      this.state.setPromptPulse(options.promptPulse ?? 0),
      this.state.setComplete(options.complete ?? false),
      this.state.setGlow(options.glow ?? false),
      this.state.setBreathe(options.breathe ?? false),
    ].some(Boolean)
  }

  setEnabled(value: boolean) {
    return this.state.setEnabled(value)
  }

  advance(deltaTime: number, frame: number) {
    if (frame === this.frame) return
    this.frame = frame
    this.state.advance(deltaTime)
  }

  get live() {
    return this.state.live
  }

  get running() {
    return this.state.running
  }

  get completion() {
    return this.state.completion
  }

  get flash() {
    return this.state.flash
  }

  get glowLevel() {
    return this.state.glowLevel
  }

  fronts(width: number) {
    return this.state.fronts(width)
  }
}

class PulseLayer {
  timeline: TabPulseTimeline
  private source: TabPulseTimeline | undefined
  private enabled: boolean
  color: RGBA
  glowColor: RGBA
  glowTail: number
  flashColor: RGBA
  completionColor: RGBA

  constructor(options: TabPulseLayer, enabled: boolean) {
    this.enabled = enabled
    this.source = options.timeline
    this.timeline = options.timeline ?? new TabPulseTimeline(options, enabled)
    if (options.timeline) options.timeline.set(options, enabled)
    this.color = options.color
    this.glowColor = options.glowColor ?? options.color
    this.glowTail = options.glowTail ?? GLOW_TAIL
    this.flashColor = options.flashColor ?? options.color
    this.completionColor = options.completionColor ?? options.color
  }

  set(options: TabPulseLayer) {
    const sourceChanged = options.timeline !== this.source
    if (sourceChanged) {
      this.source = options.timeline
      this.timeline = options.timeline ?? new TabPulseTimeline(options, this.enabled)
    }
    const stateChanged = sourceChanged
      ? (options.timeline?.set(options, this.enabled) ?? false)
      : this.timeline.set(options, this.enabled)
    const color = options.color
    const glowColor = options.glowColor ?? color
    const glowTail = options.glowTail ?? GLOW_TAIL
    const flashColor = options.flashColor ?? color
    const completionColor = options.completionColor ?? color
    const changed = [
      sourceChanged,
      stateChanged,
      !color.equals(this.color),
      !glowColor.equals(this.glowColor),
      glowTail !== this.glowTail,
      !flashColor.equals(this.flashColor),
      !completionColor.equals(this.completionColor),
    ].some(Boolean)
    this.color = color
    this.glowColor = glowColor
    this.glowTail = glowTail
    this.flashColor = flashColor
    this.completionColor = completionColor
    return changed
  }

  setEnabled(value: boolean) {
    this.enabled = value
    return this.timeline.setEnabled(value)
  }
}

const DEFAULT_LAYER: TabPulseLayer = { color: RGBA.defaultForeground() }

class TabPulseRenderable extends Renderable {
  private _enabled: boolean
  private primary: PulseLayer
  private adjacent: PulseLayer
  private primaryAssigned: boolean
  private adjacentAssigned: boolean
  private _edge: "above" | "below" | undefined
  private _backgroundColor: RGBA
  private primaryRenderColor = RGBA.fromInts(0, 0, 0)
  private adjacentRenderColor = RGBA.fromInts(0, 0, 0)
  private _onLevel: ((level: number) => void) | undefined
  private lastLevel = 0

  constructor(ctx: RenderContext, options: TabPulseOptions = {}) {
    const enabled = options.enabled ?? true
    const primary = options.layer ?? DEFAULT_LAYER
    const adjacent = options.edgeLayer ?? DEFAULT_LAYER
    const edge = options.edge
    super(ctx, {
      ...options,
      height: 1,
      live:
        enabled &&
        ((primary.active ?? false) ||
          ((primary.glow ?? false) && (primary.breathe ?? false)) ||
          (edge !== undefined &&
            ((adjacent.active ?? false) || ((adjacent.glow ?? false) && (adjacent.breathe ?? false))))),
    })
    this._enabled = enabled
    this.primary = new PulseLayer(primary, enabled)
    this.adjacent = new PulseLayer(adjacent, enabled && edge !== undefined)
    this.primaryAssigned = options.layer !== undefined
    this.adjacentAssigned = options.edgeLayer !== undefined
    this._edge = edge
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
    this._onLevel(quantized)
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    this.primary.setEnabled(value)
    this.adjacent.setEnabled(value && this._edge !== undefined)
    this.changed()
  }

  set layer(value: TabPulseLayer) {
    if (!this.primaryAssigned) {
      this.primaryAssigned = true
      this.primary = new PulseLayer(value, this._enabled)
      this.changed()
      return
    }
    if (this.primary.set(value)) this.changed()
  }

  set edgeLayer(value: TabPulseLayer) {
    if (!this.adjacentAssigned) {
      this.adjacentAssigned = true
      this.adjacent = new PulseLayer(value, this._enabled && this._edge !== undefined)
      this.changed()
      return
    }
    if (this.adjacent.set(value)) this.changed()
  }

  set edge(value: "above" | "below" | undefined) {
    if (value === this._edge) return
    this._edge = value
    this.adjacent.setEnabled(this._enabled && value !== undefined)
    this.changed()
  }

  set backgroundColor(value: RGBA) {
    if (value.equals(this._backgroundColor)) return
    this._backgroundColor = value
    this.requestRender()
  }

  private changed() {
    this.live = this.primary.timeline.live || this.adjacent.timeline.live
    this.requestRender()
  }

  protected override onUpdate(deltaTime: number): void {
    if (!this._enabled) return
    this.primary.timeline.advance(deltaTime, this.ctx.frameId)
    this.adjacent.timeline.advance(deltaTime, this.ctx.frameId)
    this.live = this.primary.timeline.live || this.adjacent.timeline.live
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed || this.width <= 0) return
    const running = this.primary.timeline.running
    const completion = this.primary.timeline.completion
    const flash = this.primary.timeline.flash
    const glowLevel = this.primary.timeline.glowLevel
    const adjacentRunning = this.adjacent.timeline.running
    const adjacentCompletion = this.adjacent.timeline.completion
    const adjacentFlash = this.adjacent.timeline.flash
    const adjacentGlowLevel = this.adjacent.timeline.glowLevel
    if (
      glowLevel === 0 &&
      running === 0 &&
      completion === 0 &&
      flash === 0 &&
      adjacentGlowLevel === 0 &&
      adjacentRunning === 0 &&
      adjacentCompletion === 0 &&
      adjacentFlash === 0
    ) {
      this.emitLevel(0)
      return
    }
    const [front, secondFront] = this.primary.timeline.fronts(this.width)
    const [adjacentFront, adjacentSecondFront] = this.adjacent.timeline.fronts(this.width)
    if (this._onLevel)
      this.emitLevel(
        running === 0
          ? 0
          : Math.max(intensityAt(1, front, RUN_HEAD, RUN_TAIL), intensityAt(1, secondFront, RUN_HEAD, RUN_TAIL)) *
              running,
      )
    const glowTail = Math.min(this.primary.glowTail, Math.max(1, this.width - 2))
    const adjacentGlowTail = Math.min(this.adjacent.glowTail, Math.max(1, this.width - 2))
    for (let index = 0; index < this.width; index++) {
      // Skip per-cell sweep and glow math when that stage is idle, e.g. a steady breathing glow.
      const sweep =
        running === 0
          ? 0
          : Math.max(
              intensityAt(index, front, RUN_HEAD, RUN_TAIL),
              intensityAt(index, secondFront, RUN_HEAD, RUN_TAIL),
            ) *
            0.14 *
            running
      const adjacentSweep =
        adjacentRunning === 0
          ? 0
          : Math.max(
              intensityAt(index, adjacentFront, RUN_HEAD, RUN_TAIL),
              intensityAt(index, adjacentSecondFront, RUN_HEAD, RUN_TAIL),
            ) *
            0.14 *
            adjacentRunning
      blendTabPulseColor(
        this.primaryRenderColor,
        this._backgroundColor,
        this.primary.glowColor,
        this.primary.color,
        this.primary.flashColor,
        this.primary.completionColor,
        glowLevel === 0 ? 0 : glowIntensityAt(index, glowTail) * GLOW_OPACITY * glowLevel,
        sweep,
        flash,
        completion,
      )
      if (!this._edge) {
        buffer.setCell(this.screenX + index, this.screenY, " ", DEFAULT_FOREGROUND, this.primaryRenderColor)
        continue
      }
      blendTabPulseColor(
        this.adjacentRenderColor,
        this._backgroundColor,
        this.adjacent.glowColor,
        this.adjacent.color,
        this.adjacent.flashColor,
        this.adjacent.completionColor,
        adjacentGlowLevel === 0 ? 0 : glowIntensityAt(index, adjacentGlowTail) * GLOW_OPACITY * adjacentGlowLevel,
        adjacentSweep,
        adjacentFlash,
        adjacentCompletion,
      )
      buffer.setCell(
        this.screenX + index,
        this.screenY,
        this._edge === "above" ? "▄" : "▀",
        this.primaryRenderColor,
        this.adjacentRenderColor,
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
  layer: TabPulseLayer
  edgeLayer?: TabPulseLayer
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
      layer={props.layer}
      edgeLayer={props.edge === undefined ? undefined : (props.edgeLayer ?? props.layer)}
      backgroundColor={props.backgroundColor}
      onLevel={props.onLevel}
    />
  )
}
