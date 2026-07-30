import { OptimizedBuffer, Renderable, RGBA, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"

type TabPulseOptions = RenderableOptions<TabPulseRenderable> & {
  enabled?: boolean
  active?: boolean
  promptPulse?: number
  complete?: boolean
  glow?: boolean
  breathe?: boolean
  color?: RGBA
  glowColor?: RGBA
  flashColor?: RGBA
  completionColor?: RGBA
  backgroundColor?: RGBA
  /** Reports the running sweep's intensity at the tab number's cell, quantized; 0 when idle. */
  onLevel?: (level: number) => void
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smootherstep = (value: number) => value * value * value * (value * (value * 6 - 15) + 10)
const RUN_DURATION = 2_800
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
export const unreadGlowIntensity = (index: number, width: number) => {
  const tail = Math.min(GLOW_TAIL, Math.max(1, width - 2))
  return smootherstep(clamp(1 - Math.max(0, index - 1) / tail))
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

class TabPulseRenderable extends Renderable {
  private _enabled: boolean
  private _active: boolean
  private _promptPulse: number
  private _complete: boolean
  private _glow: boolean
  private _breathe: boolean
  private _color: RGBA
  private _glowColor: RGBA
  private _flashColor: RGBA
  private _completionColor: RGBA
  private _backgroundColor: RGBA
  private clock = 0
  private breatheClock = 0
  private completionPending = false
  private runFade = new Envelope(RUN_FADE_OUT, fadeOut)
  private completionPulse = new Envelope(COMPLETION_DURATION, completionPulseOpacity)
  private edgeFlash = new Envelope(EDGE_FLASH_DURATION, (progress) => attackDecay(progress, EDGE_FLASH_ATTACK, 1, 0))
  private ignition = new Envelope(GLOW_IGNITION_DURATION, glowIgnitionLevel)
  private glowOff = new Envelope(GLOW_FADE_OUT, fadeOut)
  private envelopes = [this.runFade, this.completionPulse, this.edgeFlash, this.ignition, this.glowOff]
  private renderColor = RGBA.fromInts(0, 0, 0)
  private _onLevel: ((level: number) => void) | undefined
  private lastLevel = 0

  constructor(ctx: RenderContext, options: TabPulseOptions = {}) {
    const enabled = options.enabled ?? true
    const active = options.active ?? false
    super(ctx, { ...options, height: 1, live: enabled && active })
    this._enabled = enabled
    this._active = active
    this._promptPulse = options.promptPulse ?? 0
    this._complete = options.complete ?? false
    this._glow = options.glow ?? false
    this._breathe = options.breathe ?? false
    this._color = options.color ?? RGBA.defaultForeground()
    this._glowColor = options.glowColor ?? this._color
    this._flashColor = options.flashColor ?? this._color
    this._completionColor = options.completionColor ?? this._color
    this._backgroundColor = options.backgroundColor ?? RGBA.defaultBackground()
    this._onLevel = options.onLevel
  }

  set onLevel(value: ((level: number) => void) | undefined) {
    this._onLevel = value
  }

  private emitLevel(value: number) {
    const quantized = Math.round(value * 32) / 32
    if (quantized === this.lastLevel) return
    this.lastLevel = quantized
    this._onLevel?.(quantized)
  }

  private get breathing() {
    return this._enabled && this._glow && this._breathe
  }

  /** Resting glow is 1; ignition overshoots on arrival, breathing swells while pending, glowOff decays after. */
  private glowLevel() {
    if (!this._glow) return this.glowOff.level()
    const base = this.ignition.active ? this.ignition.level() : 1
    if (!this.breathing) return base
    return (
      base * (1 + GLOW_BREATHE_RISE * 0.5 * (1 - Math.cos((2 * Math.PI * this.breatheClock) / GLOW_BREATHE_PERIOD)))
    )
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    if (!value) {
      for (const envelope of this.envelopes) envelope.stop()
      this.completionPending = false
      this.breatheClock = 0
      this.live = false
    } else if (this._active || this.breathing) {
      this.live = true
    }
    this.requestRender()
  }

  set active(value: boolean) {
    if (value === this._active) return
    this._active = value
    if (!this._enabled) return
    if (value) {
      this.runFade.stop()
      this.completionPulse.stop()
      this.completionPending = false
    } else {
      this.runFade.start()
      this.completionPending = true
    }
    // The same neutral edge flash marks both the start and the finish of a run.
    this.edgeFlash.start()
    this.live = true
    this.requestRender()
  }

  set promptPulse(value: number) {
    if (value === this._promptPulse) return
    this._promptPulse = value
    if (!this._enabled) return
    this.edgeFlash.restart(PROMPT_FLASH_SCALE)
    this.live = true
    this.requestRender()
  }

  set complete(value: boolean) {
    if (value === this._complete) return
    this._complete = value
    if (!value) {
      this.completionPulse.stop()
      this.completionPending = false
    }
    if (value && this.completionPending) {
      this.completionPending = false
      if (this._enabled) {
        this.completionPulse.start()
        this.live = true
      }
    }
    this.requestRender()
  }

  set glow(value: boolean) {
    if (value === this._glow) return
    if (this._enabled && !value) this.glowOff.start(this.glowLevel())
    this._glow = value
    this.ignition.stop()
    this.breatheClock = 0
    if (this._enabled && value) {
      this.glowOff.stop()
      this.ignition.start()
      this.live = true
    }
    this.requestRender()
  }

  set breathe(value: boolean) {
    if (value === this._breathe) return
    this._breathe = value
    this.breatheClock = 0
    if (this.breathing) this.live = true
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

  set flashColor(value: RGBA) {
    if (value.equals(this._flashColor)) return
    this._flashColor = value
    this.requestRender()
  }

  set completionColor(value: RGBA) {
    if (value.equals(this._completionColor)) return
    this._completionColor = value
    this.requestRender()
  }

  set backgroundColor(value: RGBA) {
    if (value.equals(this._backgroundColor)) return
    this._backgroundColor = value
    this.requestRender()
  }

  protected override onUpdate(deltaTime: number): void {
    if (!this._enabled) return
    if (this._active || this.runFade.active) this.clock += deltaTime
    if (this.breathing) this.breatheClock += deltaTime
    for (const envelope of this.envelopes) envelope.advance(deltaTime)
    if (this.completionPending) {
      if (this._complete) {
        this.completionPending = false
        this.completionPulse.start()
      } else if (!this.runFade.active) {
        this.completionPending = false
      }
    }
    this.live = this._active || this.breathing || this.envelopes.some(envelopeActive)
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed || this.width <= 0) return
    const running = !this._enabled ? 0 : this._active ? 1 : this.runFade.level()
    const completion = this.completionPulse.level() * COMPLETION_OPACITY
    // The edge flash is a neutral wash on the running stage; the accent completion stage stays reserved for results.
    const flash = this.edgeFlash.level() * EDGE_FLASH_OPACITY
    const glowLevel = this.glowLevel()
    if (glowLevel === 0 && running === 0 && completion === 0 && flash === 0) {
      this.emitLevel(0)
      return
    }
    const progress = (this.clock % RUN_DURATION) / RUN_DURATION
    const start = -RUN_HEAD
    const end = this.width - 1 + RUN_TAIL
    const front = start + coast(progress) * (end - start)
    const secondFront = start + coast((progress + 0.5) % 1) * (end - start)
    this.emitLevel(
      running === 0
        ? 0
        : Math.max(intensityAt(1, front, RUN_HEAD, RUN_TAIL), intensityAt(1, secondFront, RUN_HEAD, RUN_TAIL)) *
            running,
    )
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
      blendTabPulseColor(
        this.renderColor,
        this._backgroundColor,
        this._glowColor,
        this._color,
        this._flashColor,
        this._completionColor,
        glowLevel === 0 ? 0 : unreadGlowIntensity(index, this.width) * GLOW_OPACITY * glowLevel,
        sweep,
        flash,
        completion,
      )
      buffer.setCell(this.screenX + index, this.screenY, " ", DEFAULT_FOREGROUND, this.renderColor)
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
  enabled?: boolean
  active: boolean
  promptPulse?: number
  complete?: boolean
  glow?: boolean
  breathe?: boolean
  color: RGBA
  glowColor?: RGBA
  flashColor?: RGBA
  completionColor?: RGBA
  backgroundColor: RGBA
  onLevel?: (level: number) => void
}) {
  return (
    <tab_pulse
      position="absolute"
      zIndex={0}
      width="100%"
      enabled={props.enabled ?? true}
      active={props.active}
      promptPulse={props.promptPulse ?? 0}
      complete={props.complete ?? false}
      glow={props.glow ?? false}
      breathe={props.breathe ?? false}
      color={props.color}
      glowColor={props.glowColor ?? props.color}
      flashColor={props.flashColor ?? props.color}
      completionColor={props.completionColor ?? props.color}
      backgroundColor={props.backgroundColor}
      onLevel={props.onLevel}
    />
  )
}
