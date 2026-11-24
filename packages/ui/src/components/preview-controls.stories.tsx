import { createEffect, createSignal } from "solid-js"
import { PreviewControls } from "./preview-controls"

const defaults = { zoom: 100, disabled: false }

export default {
  title: "UI/PreviewControls",
  id: "ui-preview-controls",
  args: defaults,
  argTypes: { zoom: { control: { type: "range", min: 50, max: 200, step: 25 } } },
  render: (args: typeof defaults) => {
    const [zoom, setZoom] = createSignal(args.zoom)

    createEffect(() => setZoom(args.zoom))

    return (
      <div class="relative grid h-52 w-full max-w-sm place-items-center overflow-hidden rounded-md bg-v2-background-bg-layer-01">
        <output class="rounded bg-v2-background-bg-base px-3 py-2" style={{ transform: `scale(${zoom() / 100})` }}>
          {zoom()}%
        </output>
        <PreviewControls
          disabled={args.disabled}
          zoomOutDisabled={zoom() <= 50}
          zoomInDisabled={zoom() >= 200}
          onZoomOut={() => setZoom((n) => Math.max(50, n - 25))}
          onZoomIn={() => setZoom((n) => Math.min(200, n + 25))}
          onFit={() => setZoom(100)}
        />
      </div>
    )
  },
}

export const Fit = {}

export const Minimum = { args: { zoom: 50 } }

export const Maximum = { args: { zoom: 200 } }

export const Disabled = { args: { disabled: true } }
