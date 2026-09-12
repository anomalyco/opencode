import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { resolveImageRenderProtocol, rgbToHex } from "@opentui/core"
import { useTheme } from "../context/theme"
import { renderMath, type RenderedMath } from "../util/latex"

// Terminals report a 1:2 cell aspect fallback before pixel geometry arrives;
// assume the same when resolution is unavailable.
const FALLBACK_CELL = { w: 8, h: 16 }

export function MathBlock(props: { tex: string; width: number; fallback: JSX.Element }) {
  const renderer = useRenderer()
  const { theme } = useTheme()

  const [caps, setCaps] = createSignal(renderer.capabilities)
  const [img, setImg] = createSignal<RenderedMath | null>(null)
  const [failed, setFailed] = createSignal(false)
  // resolution is a plain getter on the renderer; resize events signal that
  // terminal pixel geometry may have arrived or changed
  const [tick, setTick] = createSignal(0)

  const onResize = () => setTick((t) => t + 1)
  renderer.on("capabilities", setCaps)
  renderer.on("resize", onResize)
  onCleanup(() => {
    renderer.off("capabilities", setCaps)
    renderer.off("resize", onResize)
  })

  const resolution = () => {
    tick()
    const res = renderer.resolution
    if (!res || renderer.terminalWidth <= 0 || renderer.terminalHeight <= 0) return null
    return res.width > 0 && res.height > 0 ? res : null
  }

  const supported = createMemo(
    () => resolveImageRenderProtocol("auto", caps(), resolution() !== null) !== "blocks",
  )

  const cell = () => {
    const res = resolution()
    if (!res) return FALLBACK_CELL
    return { w: res.width / renderer.terminalWidth, h: res.height / renderer.terminalHeight }
  }

  createEffect(() => {
    if (!supported()) return
    let live = true
    renderMath(props.tex, { color: rgbToHex(theme.markdownText), fontPx: cell().h }).then((result) => {
      if (!live) return
      if (result) setImg(result)
      else setFailed(true)
    })
    onCleanup(() => {
      live = false
    })
  })

  const size = () => {
    const rendered = img()
    if (!rendered) return null
    const cols = Math.max(1, Math.min(Math.ceil(rendered.width / cell().w), props.width))
    const rows = Math.max(
      1,
      Math.ceil(((rendered.height / rendered.width) * cols * cell().w) / cell().h),
    )
    return { cols, rows }
  }

  return (
    <Show when={supported() && !failed() && img() && size()} fallback={props.fallback}>
      <image source={img()!.png} width={size()!.cols} height={size()!.rows} protocol="auto" fit="fit" />
    </Show>
  )
}
