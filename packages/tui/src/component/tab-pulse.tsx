import { OptimizedBuffer, Renderable, RGBA, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"

type TabPulseOptions = RenderableOptions<TabPulseRenderable> & {
  active?: boolean
  color?: RGBA
  backgroundColor?: RGBA
  duration?: number
  easing?: PulseEasing
  head?: number
  tail?: number
  wrap?: boolean
}

export type PulseEasing = "linear" | "smooth" | "coast" | "sine" | "spring" | "bounce" | "scanner"

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smootherstep = (value: number) => value * value * value * (value * (value * 6 - 15) + 10)
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
const ease = (value: number, easing: PulseEasing) => {
  if (easing === "linear") return value
  if (easing === "smooth") return smootherstep(value)
  if (easing === "sine") return (1 - Math.cos(Math.PI * value)) / 2
  if (easing === "spring") return 1 - Math.exp(-5 * value) * Math.cos(10 * value)
  if (easing === "scanner") return value < 0.5 ? value * 2 : 2 - value * 2
  if (easing === "bounce") {
    const scale = 7.5625
    if (value < 1 / 2.75) return scale * value * value
    if (value < 2 / 2.75) return scale * (value - 1.5 / 2.75) ** 2 + 0.75
    if (value < 2.5 / 2.75) return scale * (value - 2.25 / 2.75) ** 2 + 0.9375
    return scale * (value - 2.625 / 2.75) ** 2 + 0.984375
  }
  return coast(value)
}
const blend = (from: RGBA, to: RGBA, amount: number) =>
  RGBA.fromValues(
    from.r + (to.r - from.r) * amount,
    from.g + (to.g - from.g) * amount,
    from.b + (to.b - from.b) * amount,
    from.a + (to.a - from.a) * amount,
  )

class TabPulseRenderable extends Renderable {
  private _active: boolean
  private _color: RGBA
  private _backgroundColor: RGBA
  private _duration: number
  private _easing: PulseEasing
  private _head: number
  private _tail: number
  private _wrap: boolean
  private clock = 0

  constructor(ctx: RenderContext, options: TabPulseOptions = {}) {
    const active = options.active ?? false
    super(ctx, { ...options, height: 1, live: active })
    this._active = active
    this._color = options.color ?? RGBA.defaultForeground()
    this._backgroundColor = options.backgroundColor ?? RGBA.defaultBackground()
    this._duration = options.duration ?? 2_800
    this._easing = options.easing ?? "coast"
    this._head = options.head ?? 4
    this._tail = options.tail ?? 18
    this._wrap = options.wrap ?? false
  }

  set active(value: boolean) {
    if (value === this._active) return
    this._active = value
    this.live = value
    this.requestRender()
  }

  set color(value: RGBA) {
    if (value.equals(this._color)) return
    this._color = value
    this.requestRender()
  }

  set backgroundColor(value: RGBA) {
    if (value.equals(this._backgroundColor)) return
    this._backgroundColor = value
    this.requestRender()
  }

  set duration(value: number) {
    if (value === this._duration) return
    this._duration = value
    this.requestRender()
  }

  set easing(value: PulseEasing) {
    if (value === this._easing) return
    this._easing = value
    this.requestRender()
  }

  set head(value: number) {
    if (value === this._head) return
    this._head = value
    this.requestRender()
  }

  set tail(value: number) {
    if (value === this._tail) return
    this._tail = value
    this.requestRender()
  }

  set wrap(value: boolean) {
    if (value === this._wrap) return
    this._wrap = value
    this.requestRender()
  }

  protected override onUpdate(deltaTime: number): void {
    if (!this._active) return
    this.clock += deltaTime
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed || !this._active || this.width <= 0) return
    const progress = (this.clock % this._duration) / this._duration
    if (this._wrap) {
      const start = -this._head
      const end = this.width - 1 + this._tail
      const front = start + ease(progress, this._easing) * (end - start)
      const secondProgress = (progress + 0.5) % 1
      const secondFront = start + ease(secondProgress, this._easing) * (end - start)
      Array.from({ length: this.width }, (_, index) => {
        const intensity = Math.max(
          intensityAt(index, front, this._head, this._tail),
          intensityAt(index, secondFront, this._head, this._tail),
        )
        buffer.setCell(
          this.screenX + index,
          this.screenY,
          " ",
          RGBA.defaultForeground(),
          blend(this._backgroundColor, this._color, intensity * 0.14),
        )
      })
      return
    }
    const start = -this._head
    const end = this.width - 1 + this._tail
    const front = start + ease(progress, this._easing) * (end - start)
    Array.from({ length: this.width }, (_, index) => {
      const intensity = intensityAt(index, front, this._head, this._tail)
      buffer.setCell(
        this.screenX + index,
        this.screenY,
        " ",
        RGBA.defaultForeground(),
        blend(this._backgroundColor, this._color, intensity * 0.14),
      )
    })
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    tab_pulse: typeof TabPulseRenderable
  }
}

extend({ tab_pulse: TabPulseRenderable })

export function TabPulse(props: {
  active: boolean
  color: RGBA
  backgroundColor: RGBA
  duration?: number
  easing?: PulseEasing
  head?: number
  tail?: number
  wrap?: boolean
}) {
  return (
    <tab_pulse
      position="absolute"
      zIndex={0}
      width="100%"
      active={props.active}
      color={props.color}
      backgroundColor={props.backgroundColor}
      duration={props.duration ?? 2_800}
      easing={props.easing ?? "coast"}
      head={props.head ?? 4}
      tail={props.tail ?? 18}
      wrap={props.wrap ?? false}
    />
  )
}
