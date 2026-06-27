import {
  FrameBufferRenderable,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { ShatterPainter } from "./shatter-intro-render"

type ShatterIntroOptions = RenderableOptions<FrameBufferRenderable> & {
  onDone?: () => void
}

class ShatterIntroRenderable extends FrameBufferRenderable {
  private painter = new ShatterPainter()

  constructor(ctx: RenderContext, options: ShatterIntroOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1
    const height = typeof options.height === "number" ? options.height : 1
    super(ctx, {
      ...options,
      width,
      height,
      live: options.live ?? true,
      respectAlpha: true,
    })

    if (options.width !== undefined && typeof options.width !== "number") this.width = options.width
    if (options.height !== undefined && typeof options.height !== "number") this.height = options.height
    this.painter.onComplete = options.onDone
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    if (!this.visible || this.isDestroyed) return

    this._ctx.setCursorPosition(0, 0, false)
    this.painter.render(this.frameBuffer, deltaTime)
    super.renderSelf(buffer)
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    shatter_intro: typeof ShatterIntroRenderable
  }
}

extend({ shatter_intro: ShatterIntroRenderable })

export function ShatterIntro(props: { onDone?: () => void }) {
  const renderer = useRenderer()
  let targetFps = renderer.targetFps
  let maxFps = renderer.maxFps

  onMount(() => {
    targetFps = renderer.targetFps
    maxFps = renderer.maxFps
    renderer.targetFps = 30
    renderer.maxFps = 30
    renderer.setCursorPosition(0, 0, false)
  })

  onCleanup(() => {
    renderer.targetFps = targetFps
    renderer.maxFps = maxFps
    renderer.setCursorPosition(0, 0, true)
  })

  return (
    <shatter_intro
      width="100%"
      height="100%"
      onDone={props.onDone}
      live
    />
  )
}
