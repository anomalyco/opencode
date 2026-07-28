import { OptimizedBuffer, Renderable, RGBA, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"

type TabPulseOptions = RenderableOptions<TabPulseRenderable> & {
  active?: boolean
  color?: RGBA
  backgroundColor?: RGBA
}

const PERIOD = 2_800
const HEAD = 4
const TAIL = 18
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smootherstep = (value: number) => value * value * value * (value * (value * 6 - 15) + 10)
const coast = (value: number) => {
  const ramp = 0.2
  if (value < ramp) return (value * value) / (2 * ramp * (1 - ramp))
  if (value > 1 - ramp) return 1 - ((1 - value) * (1 - value)) / (2 * ramp * (1 - ramp))
  return (value - ramp / 2) / (1 - ramp)
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
  private clock = 0

  constructor(ctx: RenderContext, options: TabPulseOptions = {}) {
    const active = options.active ?? false
    super(ctx, { ...options, height: 1, live: active })
    this._active = active
    this._color = options.color ?? RGBA.defaultForeground()
    this._backgroundColor = options.backgroundColor ?? RGBA.defaultBackground()
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

  protected override onUpdate(deltaTime: number): void {
    if (!this._active) return
    this.clock += deltaTime
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed || !this._active || this.width <= 0) return
    const start = -HEAD
    const end = this.width - 1 + TAIL
    const front = start + coast((this.clock % PERIOD) / PERIOD) * (end - start)
    Array.from({ length: this.width }, (_, index) => {
      const distance = front - index
      const intensity =
        distance < 0 ? smootherstep(clamp(1 + distance / HEAD)) : smootherstep(clamp(1 - distance / TAIL))
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

export function TabPulse(props: { active: boolean; color: RGBA; backgroundColor: RGBA }) {
  return (
    <tab_pulse
      position="absolute"
      zIndex={0}
      width="100%"
      active={props.active}
      color={props.color}
      backgroundColor={props.backgroundColor}
    />
  )
}
