import { Dialog } from "@kobalte/core/dialog"
import { createEffect, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import {
  clampMermaidZoom,
  fitMermaidZoom,
  mermaidColorScheme,
  renderMermaid,
  stepMermaidZoom,
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
  const [zoom, setZoom] = createSignal(1)
  const [fit, setFit] = createSignal(1)
  const [natural, setNatural] = createSignal<{ width: number; height: number }>()
  const [markup, setMarkup] = createSignal("")
  let scroll: HTMLDivElement | undefined
  let canvas: HTMLDivElement | undefined

  createEffect(() => {
    const scheme = mermaidColorScheme()
    void renderMermaid(props.source, scheme).then((result) => {
      if (result.ok && scheme === mermaidColorScheme()) setMarkup(result.svg)
    })
  })

  // Measure the fresh SVG and start at a fit-to-viewport zoom, but only fit once so
  // theme-driven re-renders keep the user's zoom level.
  createEffect(() => {
    if (!markup() || !canvas || !scroll) return
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
    const fitted = fitMermaidZoom(box, {
      width: scroll.clientWidth - 96,
      height: scroll.clientHeight - 96,
    })
    setFit(fitted)
    setZoom(fitted)
  })

  const width = () => {
    const size = natural()
    return size ? `${Math.round(size.width * zoom())}px` : "auto"
  }

  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    setZoom((value) => clampMermaidZoom(value * Math.exp(-event.deltaY / 200)))
  }

  return (
    <Dialog open modal onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay data-component="mermaid-viewer-overlay" />
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
                  onClick={() => setZoom((value) => stepMermaidZoom(value, -1))}
                />
              </TooltipV2>
              <TooltipV2 placement="bottom" value={props.labels.zoomReset}>
                <button
                  type="button"
                  data-slot="mermaid-viewer-zoom-level"
                  aria-label={props.labels.zoomReset}
                  onClick={() => setZoom(fit())}
                >
                  {Math.round(zoom() * 100)}%
                </button>
              </TooltipV2>
              <TooltipV2 placement="bottom" value={props.labels.zoomIn}>
                <IconButtonV2
                  type="button"
                  size="normal"
                  variant="ghost-muted"
                  aria-label={props.labels.zoomIn}
                  icon={<Icon name="plus" />}
                  onClick={() => setZoom((value) => stepMermaidZoom(value, 1))}
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
              data-slot="mermaid-viewer-scroll"
              ref={scroll}
              onWheel={wheel}
              onClick={(event) => event.target === event.currentTarget && props.onClose()}
            >
              <div data-slot="mermaid-viewer-canvas" ref={canvas} style={{ width: width() }} innerHTML={markup()} />
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  )
}
