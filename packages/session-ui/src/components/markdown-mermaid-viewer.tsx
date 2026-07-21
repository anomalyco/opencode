import { Dialog } from "@kobalte/core/dialog"
import { createEffect, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import {
  fitMermaidCamera,
  mermaidColorScheme,
  renderMermaid,
  stepMermaidZoom,
  zoomMermaidCamera,
  type MermaidCamera,
} from "./markdown-mermaid"

export type MermaidViewerLabels = {
  zoomIn: string
  zoomOut: string
  zoomReset: string
  close: string
}

let active = false

export function openMermaidViewer(input: { source: string; labels: MermaidViewerLabels }) {
  if (active || typeof document !== "object") return
  active = true
  const host = document.createElement("div")
  document.body.appendChild(host)
  let dispose = () => {}
  const close = () => {
    active = false
    dispose()
    host.remove()
  }
  dispose = render(() => <MermaidViewer source={input.source} labels={input.labels} onClose={close} />, host)
}

function MermaidViewer(props: { source: string; labels: MermaidViewerLabels; onClose: () => void }) {
  const [camera, setCamera] = createSignal({ zoom: 1, x: 0, y: 0 } satisfies MermaidCamera)
  const [fit, setFit] = createSignal({ zoom: 1, x: 0, y: 0 } satisfies MermaidCamera)
  const [natural, setNatural] = createSignal<{ width: number; height: number }>()
  const [markup, setMarkup] = createSignal("")
  let canvas: HTMLDivElement | undefined
  let panning: { id: number; x: number; y: number } | undefined

  createEffect(() => {
    const scheme = mermaidColorScheme()
    void renderMermaid(props.source, scheme).then((result) => {
      if (result.ok && scheme === mermaidColorScheme()) setMarkup(result.svg)
    })
  })

  // Measure the fresh SVG and start at a centered fit, but only once so theme-driven
  // re-renders keep the user's camera.
  createEffect(() => {
    if (!markup() || !canvas) return
    const svg = canvas.querySelector("svg")
    if (!svg) return
    svg.style.maxWidth = "none"
    svg.style.width = "100%"
    svg.style.height = "auto"
    const box = svg.viewBox.baseVal
    if (!box?.width || !box?.height) return
    const first = !natural()
    setNatural({ width: box.width, height: box.height })
    if (!first) return
    const fitted = fitMermaidCamera(box, { width: canvas.clientWidth, height: canvas.clientHeight })
    setFit(fitted)
    setCamera(fitted)
  })

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = canvas!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const center = () => ({ x: (canvas?.clientWidth ?? 0) / 2, y: (canvas?.clientHeight ?? 0) / 2 })

  const zoomAt = (point: { x: number; y: number }, zoom: number) =>
    setCamera((current) => zoomMermaidCamera(current, zoom, point))

  // Figma-style input: plain wheel pans, ctrl/cmd + wheel (trackpad pinch) zooms at the cursor.
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      zoomAt(localPoint(event), camera().zoom * Math.exp(-event.deltaY / 150))
      return
    }
    setCamera((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
  }

  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !canvas) return
    canvas.setPointerCapture(event.pointerId)
    canvas.dataset.panning = "true"
    panning = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const pointerMove = (event: PointerEvent) => {
    if (panning?.id !== event.pointerId) return
    const dx = event.clientX - panning.x
    const dy = event.clientY - panning.y
    panning = { id: event.pointerId, x: event.clientX, y: event.clientY }
    setCamera((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
  }

  const pointerUp = (event: PointerEvent) => {
    if (panning?.id !== event.pointerId) return
    panning = undefined
    if (canvas) delete canvas.dataset.panning
  }

  const stageStyle = () => {
    const size = natural()
    const current = camera()
    return {
      width: size ? `${size.width}px` : "auto",
      transform: `translate(${current.x}px, ${current.y}px) scale(${current.zoom})`,
    }
  }

  return (
    <Dialog open modal onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay data-component="mermaid-viewer-overlay" onClick={props.onClose} />
        <div data-component="mermaid-viewer">
          <Dialog.Content data-slot="mermaid-viewer-content">
            <div data-slot="mermaid-viewer-toolbar">
              <TooltipV2 placement="bottom" value={props.labels.zoomOut}>
                <IconButtonV2
                  type="button"
                  size="normal"
                  variant="ghost-muted"
                  aria-label={props.labels.zoomOut}
                  icon={<Icon name="minus" />}
                  onClick={() => zoomAt(center(), stepMermaidZoom(camera().zoom, -1))}
                />
              </TooltipV2>
              <TooltipV2 placement="bottom" value={props.labels.zoomReset}>
                <button
                  type="button"
                  data-slot="mermaid-viewer-zoom-level"
                  aria-label={props.labels.zoomReset}
                  onClick={() => setCamera(fit())}
                >
                  {Math.round(camera().zoom * 100)}%
                </button>
              </TooltipV2>
              <TooltipV2 placement="bottom" value={props.labels.zoomIn}>
                <IconButtonV2
                  type="button"
                  size="normal"
                  variant="ghost-muted"
                  aria-label={props.labels.zoomIn}
                  icon={<Icon name="plus" />}
                  onClick={() => zoomAt(center(), stepMermaidZoom(camera().zoom, 1))}
                />
              </TooltipV2>
              <TooltipV2 placement="bottom" value={props.labels.close}>
                <IconButtonV2
                  type="button"
                  size="normal"
                  variant="ghost-muted"
                  aria-label={props.labels.close}
                  icon={<Icon name="close" />}
                  onClick={props.onClose}
                />
              </TooltipV2>
            </div>
            <div
              data-slot="mermaid-viewer-canvas"
              ref={canvas}
              onWheel={wheel}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onDblClick={(event) => zoomAt(localPoint(event), stepMermaidZoom(camera().zoom, 1))}
            >
              <div data-slot="mermaid-viewer-stage" style={stageStyle()} innerHTML={markup()} />
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  )
}
