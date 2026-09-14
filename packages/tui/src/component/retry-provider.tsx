import {
  CliRenderer,
  RGBA,
  RootTextNodeRenderable,
  TextNodeRenderable,
  type Renderable,
  type RenderContext,
  type TextNodeOptions,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { createEffect, onCleanup } from "solid-js"
import { smootherstep } from "./tab-pulse"
import { stringWidth } from "../util/string-width"
import { webSearchProviderName } from "../util/tool-display"

type Value = { id: string; provider: string; running: boolean }
type Options = TextNodeOptions & { value?: Value; enabled?: boolean }

const FADE = 80
const RESIZE = 60
const DURATION = FADE * 2 + RESIZE

/** An inline span: keep native wrapping, selection, and the surrounding tool's styles. */
export class RetryProviderRenderable extends TextNodeRenderable {
  private readonly ctx: CliRenderer
  private current?: Value
  private enabledValue: boolean
  private painted = false
  private disposed = false
  private elapsed: number | undefined
  private fresh = false
  private source = ""
  private target = ""
  private displayed = ""
  private opacity = 1
  private fromOpacity = 1

  constructor(ctx: RenderContext, options: Options) {
    super(options)
    if (!(ctx instanceof CliRenderer)) throw new Error("RetryProvider requires a renderer frame clock")
    this.ctx = ctx
    this.enabledValue = options.enabled ?? true
    if (options.value) this.value = options.value
  }

  private markPainted = () => {
    if (!this.onScreen()) return
    this.painted = true
    this.ctx.off("frame", this.markPainted)
  }

  private onScreen() {
    let node: TextNodeRenderable | null = this
    while (node && !(node instanceof RootTextNodeRenderable)) {
      if (!node.visible) return false
      node = node.parent
    }
    if (!node) return false
    const text = node.textParent
    if (
      text.width <= 0 ||
      text.height <= 0 ||
      text.screenX < 0 ||
      text.screenY < 0 ||
      text.screenX + text.width > this.ctx.width ||
      text.screenY + text.height > this.ctx.height
    )
      return false
    // Be conservative with clipped rows: do not start a transition as history enters the viewport.
    for (let parent: Renderable | null = text; parent; parent = parent.parent) {
      if (!parent.visible) return false
      if (parent.overflow === "visible") continue
      if (
        text.screenX < parent.screenX ||
        text.screenY < parent.screenY ||
        text.screenX + text.width > parent.screenX + parent.width ||
        text.screenY + text.height > parent.screenY + parent.height
      )
        return false
    }
    return true
  }

  set value(value: Value) {
    if (this.disposed) return
    const previous = this.current
    this.current = value
    if (!value.running) this.ctx.off("frame", this.markPainted)
    if (previous?.id === value.id && previous.provider === value.provider) return
    this.target = webSearchProviderName(value.provider)
    const retry =
      this.enabledValue &&
      this.painted &&
      previous?.id === value.id &&
      previous.running &&
      value.running &&
      this.onScreen()
    if (!retry) {
      this.finish()
      this.painted = false
      this.ctx.off("frame", this.markPainted)
      if (value.running) this.ctx.on("frame", this.markPainted)
      return
    }
    // During fade-out, replace the destination without restarting or queuing transitions.
    if (this.elapsed !== undefined && this.elapsed < FADE) return
    this.source = this.displayed
    this.fromOpacity = this.opacity
    const start = this.elapsed === undefined
    this.elapsed = 0
    this.fresh = true
    if (start) {
      this.ctx.setFrameCallback(this.tick)
      this.ctx.requestLive()
    }
  }

  set enabled(value: boolean) {
    if (value === this.enabledValue) return
    this.enabledValue = value
    if (!value) this.finish()
  }

  private tick = async (delta: number) => {
    if (this.elapsed === undefined) return
    if (!this.onScreen()) {
      this.finish()
      this.painted = false
      if (this.current?.running) this.ctx.on("frame", this.markPainted)
      return
    }
    // Ignore time the renderer spent idle before this transition started.
    this.elapsed += this.fresh ? 0 : delta
    this.fresh = false
    if (this.elapsed >= DURATION) return this.finish()
    if (this.elapsed < FADE) {
      return this.show(this.source, this.fromOpacity * (1 - smootherstep(this.elapsed / FADE)))
    }
    if (this.elapsed < FADE + RESIZE) {
      // Move the query only while the name is invisible; never reveal partial provider glyphs.
      const from = stringWidth(this.source)
      const to = stringWidth(this.target)
      return this.show(" ".repeat(Math.round(from + (to - from) * smootherstep((this.elapsed - FADE) / RESIZE))), 0)
    }
    this.show(this.target, smootherstep((this.elapsed - FADE - RESIZE) / FADE))
  }

  private show(text: string, opacity: number) {
    if (text === this.displayed && opacity === this.opacity) return
    this.displayed = text
    this.opacity = opacity
    this.children = [text]
  }

  private stop() {
    if (this.elapsed !== undefined) {
      this.ctx.removeFrameCallback(this.tick)
      this.ctx.dropLive()
    }
    this.elapsed = undefined
  }

  private finish() {
    this.stop()
    this.show(this.target, 1)
  }

  override gatherWithInheritedStyle(style?: Parameters<TextNodeRenderable["gatherWithInheritedStyle"]>[0]) {
    const chunks = super.gatherWithInheritedStyle(style)
    if (this.opacity === 1) return chunks
    return chunks.map((chunk) => {
      const fg = RGBA.clone(chunk.fg ?? RGBA.defaultForeground())
      fg.a *= this.opacity
      return { ...chunk, fg }
    })
  }

  override destroy() {
    if (this.disposed) return
    this.disposed = true
    this.ctx.off("frame", this.markPainted)
    this.stop()
    super.destroy()
  }

  override destroyRecursively() {
    this.destroy()
  }
}

extend({ retry_provider: RetryProviderRenderable })

export function RetryProvider(props: { value: Value; enabled: boolean }) {
  // Solid's text-node reconciler only applies inline styles; control the custom span through its ref.
  return (
    <retry_provider
      ref={(node) => {
        onCleanup(() => node.destroy())
        createEffect(() => {
          node.enabled = props.enabled
          node.value = props.value
        })
      }}
    />
  )
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    retry_provider: typeof RetryProviderRenderable
  }
}
