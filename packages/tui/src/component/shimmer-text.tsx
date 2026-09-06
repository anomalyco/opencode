import { RGBA, type OptimizedBuffer, type RenderContext, type TextOptions } from "@opentui/core"
import { extend, type JSX } from "@opentui/solid"
import { splitProps } from "solid-js"
import { MaskedTextRenderable } from "./masked-text"
import { coast, intensityAt } from "./tab-pulse"

type ShimmerTextOptions = TextOptions & {
  shimmer: RGBA
}

const DURATION = 1200

class ShimmerTextRenderable extends MaskedTextRenderable {
  private _shimmer = RGBA.defaultForeground()
  private elapsed = 0

  constructor(ctx: RenderContext, options: ShimmerTextOptions) {
    super(ctx, options)
    this.matrix[3] = this._shimmer.r
    this.matrix[7] = this._shimmer.g
    this.matrix[11] = this._shimmer.b
    this.matrix[15] = 1
    if (options.shimmer) this.shimmer = options.shimmer
    this.live = true
  }

  set shimmer(value: RGBA) {
    if (value.equals(this._shimmer)) return
    this._shimmer = value
    this.matrix[3] = value.r
    this.matrix[7] = value.g
    this.matrix[11] = value.b
    this.requestRender()
  }

  override render(buffer: OptimizedBuffer, deltaTime: number) {
    if (!this.visible || this.isDestroyed || !Number.isFinite(this.width) || this.width <= 0 || this.height <= 0) return
    this.elapsed = (this.elapsed + deltaTime) % DURATION
    this.renderMasked(buffer, 0, (end) => {
      const front = -4 + coast(this.elapsed / DURATION) * (end + 22)
      return (column) => intensityAt(column, front, 4, 18)
    })
  }
}

extend({ shimmer_text: ShimmerTextRenderable })

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    shimmer_text: typeof ShimmerTextRenderable
  }
}

type Props = Omit<JSX.IntrinsicElements["text"], "ref"> & { shimmer: RGBA }

export function ShimmerText(props: Props) {
  const [local, text] = splitProps(props, ["shimmer"])
  return <shimmer_text {...text} shimmer={local.shimmer} />
}
