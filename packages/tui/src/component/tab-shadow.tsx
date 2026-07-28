import {
  OptimizedBuffer,
  Renderable,
  RGBA,
  TargetChannel,
  type RenderableOptions,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"

type TabShadowOptions = RenderableOptions<TabShadowRenderable> & {
  strength?: number
  color?: RGBA
}

class TabShadowRenderable extends Renderable {
  private _strength: number
  private _color: RGBA

  constructor(ctx: RenderContext, options: TabShadowOptions = {}) {
    super(ctx, { ...options, height: 1 })
    this._strength = options.strength ?? 0.1
    this._color = options.color ?? RGBA.defaultBackground()
  }

  set strength(value: number) {
    if (value === this._strength) return
    this._strength = value
    this.requestRender()
  }

  set color(value: RGBA) {
    if (value.equals(this._color)) return
    this._color = value
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed || this.width <= 0 || this.screenY >= buffer.height) return
    const mask = Float32Array.from(
      Array.from({ length: this.width }, (_, index) => [this.screenX + index, this.screenY, this._strength]).flat(),
    )
    buffer.colorMatrix(
      new Float32Array([0, 0, 0, this._color.r, 0, 0, 0, this._color.g, 0, 0, 0, this._color.b, 0, 0, 0, 1]),
      mask,
      1,
      TargetChannel.Both,
    )
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    tab_shadow: typeof TabShadowRenderable
  }
}

extend({ tab_shadow: TabShadowRenderable })

export function TabShadow(props: { strength: number; color: RGBA }) {
  return (
    <tab_shadow
      position="absolute"
      top={1}
      left={0}
      right={0}
      zIndex={10}
      strength={props.strength}
      color={props.color}
    />
  )
}
