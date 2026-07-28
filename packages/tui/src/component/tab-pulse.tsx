import { OptimizedBuffer, Renderable, RGBA, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"
import { tint } from "../theme/color"

type TabPulseOptions = RenderableOptions<TabPulseRenderable> & {
  enabled?: boolean
  active?: boolean
  complete?: boolean
  color?: RGBA
  completionColor?: RGBA
  backgroundColor?: RGBA
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smootherstep = (value: number) => value * value * value * (value * (value * 6 - 15) + 10)
const RUN_DURATION = 2_800
const RUN_HEAD = 4
const RUN_TAIL = 18
const RUN_FADE_OUT = 500
const COMPLETION_DURATION = 900
const COMPLETION_ATTACK = 0.16
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
export const completionPulseOpacity = (progress: number) =>
  progress < COMPLETION_ATTACK
    ? smootherstep(clamp(progress / COMPLETION_ATTACK))
    : 1 - smootherstep(clamp((progress - COMPLETION_ATTACK) / (1 - COMPLETION_ATTACK)))
class TabPulseRenderable extends Renderable {
  private _enabled: boolean
  private _active: boolean
  private _complete: boolean
  private _color: RGBA
  private _completionColor: RGBA
  private _backgroundColor: RGBA
  private clock = 0
  private fadeClock: number | undefined
  private completionClock: number | undefined
  private completionPending = false

  constructor(ctx: RenderContext, options: TabPulseOptions = {}) {
    const enabled = options.enabled ?? true
    const active = options.active ?? false
    super(ctx, { ...options, height: 1, live: enabled && active })
    this._enabled = enabled
    this._active = active
    this._complete = options.complete ?? false
    this._color = options.color ?? RGBA.defaultForeground()
    this._completionColor = options.completionColor ?? this._color
    this._backgroundColor = options.backgroundColor ?? RGBA.defaultBackground()
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return
    this._enabled = value
    if (!value) {
      this.fadeClock = undefined
      this.completionClock = undefined
      this.completionPending = false
      this.live = false
    } else if (this._active) {
      this.live = true
    }
    this.requestRender()
  }

  set active(value: boolean) {
    if (value === this._active) return
    this._active = value
    if (!this._enabled) return
    if (value) {
      this.fadeClock = undefined
      this.completionClock = undefined
      this.completionPending = false
      this.live = true
    } else {
      this.fadeClock = 0
      this.completionPending = true
      this.live = true
    }
    this.requestRender()
  }

  set complete(value: boolean) {
    if (value === this._complete) return
    this._complete = value
    if (!value) {
      this.completionClock = undefined
      this.completionPending = false
    }
    if (value && this.completionPending) {
      this.completionClock = 0
      this.completionPending = false
      this.live = this._enabled
    }
    this.requestRender()
  }

  set color(value: RGBA) {
    if (value.equals(this._color)) return
    this._color = value
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
    if (this._active || this.fadeClock !== undefined) this.clock += deltaTime
    if (this.fadeClock !== undefined) {
      this.fadeClock += deltaTime
      if (this.fadeClock >= RUN_FADE_OUT) this.fadeClock = undefined
    }
    if (this.completionPending) {
      if (this._complete) {
        this.completionClock = 0
        this.completionPending = false
      } else if (this.fadeClock === undefined) {
        this.completionPending = false
      }
    }
    if (this.completionClock !== undefined) {
      this.completionClock += deltaTime
      if (this.completionClock >= COMPLETION_DURATION) this.completionClock = undefined
    }
    this.live = this._active || this.fadeClock !== undefined || this.completionClock !== undefined
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed || !this._enabled || this.width <= 0) return
    const runningOpacity = this._active
      ? 1
      : this.fadeClock === undefined
        ? 0
        : 1 - smootherstep(clamp(this.fadeClock / RUN_FADE_OUT))
    const completionOpacity =
      this.completionClock === undefined ? 0 : completionPulseOpacity(this.completionClock / COMPLETION_DURATION)
    if (runningOpacity === 0 && completionOpacity === 0) return
    const progress = (this.clock % RUN_DURATION) / RUN_DURATION
    const start = -RUN_HEAD
    const end = this.width - 1 + RUN_TAIL
    const front = start + coast(progress) * (end - start)
    const secondFront = start + coast((progress + 0.5) % 1) * (end - start)
    for (let index = 0; index < this.width; index++) {
      const intensity = Math.max(
        intensityAt(index, front, RUN_HEAD, RUN_TAIL),
        intensityAt(index, secondFront, RUN_HEAD, RUN_TAIL),
      )
      const running = tint(this._backgroundColor, this._color, intensity * 0.14 * runningOpacity)
      buffer.setCell(
        this.screenX + index,
        this.screenY,
        " ",
        RGBA.defaultForeground(),
        tint(running, this._completionColor, completionOpacity * 0.18),
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
  enabled?: boolean
  active: boolean
  complete?: boolean
  color: RGBA
  completionColor?: RGBA
  backgroundColor: RGBA
}) {
  return (
    <tab_pulse
      position="absolute"
      zIndex={0}
      width="100%"
      enabled={props.enabled ?? true}
      active={props.active}
      complete={props.complete ?? false}
      color={props.color}
      completionColor={props.completionColor ?? props.color}
      backgroundColor={props.backgroundColor}
    />
  )
}
