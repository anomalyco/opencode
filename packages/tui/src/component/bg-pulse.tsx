import {
  FrameBufferRenderable,
  RGBA,
  SystemClock,
  type OptimizedBuffer,
  type RenderContext,
  type Renderable,
  type RenderableOptions,
  type TimerHandle,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { useConfig } from "../config"
import { GoUpsellArtPainter } from "./bg-pulse-render"

type GoUpsellArtOptions = RenderableOptions<FrameBufferRenderable> & {
  backgroundPanel?: RGBA
  primary?: RGBA
  logoBase?: RGBA
  animated?: boolean
}

class GoUpsellArtRenderable extends FrameBufferRenderable {
  private painter = new GoUpsellArtPainter()
  private clock = new SystemClock()
  private timer: TimerHandle | undefined
  private deltaTime = 0

  constructor(ctx: RenderContext, options: GoUpsellArtOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1
    const height = typeof options.height === "number" ? options.height : 1
    super(ctx, {
      ...options,
      width,
      height,
      live: false,
      respectAlpha: false,
    })

    if (options.width !== undefined && typeof options.width !== "number") this.width = options.width
    if (options.height !== undefined && typeof options.height !== "number") this.height = options.height
    this.painter.setBackgroundPanel(options.backgroundPanel)
    this.painter.setPrimary(options.primary)
    this.painter.setLogoBase(options.logoBase)
    this.animated = options.animated ?? false
  }

  set backgroundPanel(value: RGBA | undefined) {
    if (this.painter.setBackgroundPanel(value)) this.requestRender()
  }

  set logoBase(value: RGBA | undefined) {
    if (this.painter.setLogoBase(value)) this.requestRender()
  }

  set primary(value: RGBA | undefined) {
    if (this.painter.setPrimary(value)) this.requestRender()
  }

  set animated(value: boolean) {
    if (this.timer !== undefined) this.clock.clearInterval(this.timer)
    this.timer = undefined
    this.deltaTime = 0
    if (!value) return

    // Unrelated renderer frames must not advance the animation's clock.
    let previous = this.clock.now()
    this.timer = this.clock.setInterval(() => {
      const now = this.clock.now()
      const deltaTime = now - previous
      previous = now
      if (!this.visible || this.isDestroyed) return
      for (let node: Renderable | null = this.parent; node; node = node.parent) {
        if (!node.visible || node.isDestroyed) return
      }
      this.deltaTime += deltaTime
      this.requestRender()
    }, 1000 / 30)
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed) return

    this.painter.render(this.frameBuffer, {
      deltaTime: this.deltaTime,
      rgb: this._ctx.capabilities?.rgb === true,
    })
    this.deltaTime = 0
    super.renderSelf(buffer)
  }

  protected override destroySelf(): void {
    this.animated = false
    super.destroySelf()
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    go_upsell_art: typeof GoUpsellArtRenderable
  }
}

extend({ go_upsell_art: GoUpsellArtRenderable })

export function BgPulse(props: { backgroundPanel: RGBA; primary: RGBA; logoBase: RGBA }) {
  const config = useConfig().data

  return (
    <go_upsell_art
      width="100%"
      height="100%"
      backgroundPanel={props.backgroundPanel}
      primary={props.primary}
      logoBase={props.logoBase}
      animated={config.animations ?? true}
    />
  )
}
