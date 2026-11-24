import { createResource, Show } from "solid-js"

// The site's Anomaly wordmark (the press kit's vector), and how many CRT pixels wide it is drawn.
const source = "/press/anomaly/anomaly-wordmark-white.svg"
const columns = 64

type Cells = { path: string; cells: (readonly [number, number])[]; width: number; height: number }
let cached: Promise<Cells> | undefined
/** The rasterised wordmark once ready, for the canvas screen (screen-canvas.ts). */
export let pixelLogo: Cells | undefined

/** Rasterises the wordmark once; later calls share the result. */
export function loadPixelLogo() {
  cached ??= rasterise().then((result) => (pixelLogo = result))
  return cached
}

/**
 * The Anomaly wordmark as the CRT draws it: the real logo vector rasterised to a coarse grid (64
 * cells wide, cropped to the ink) and drawn as square cells in the phosphor colour, like the
 * screen's bitmap font (pixel-text.tsx), so the scanlines, glow and mask fall on it the same way.
 */
export function PixelLogo(props: { class?: string; label?: string }) {
  const [cells] = createResource(loadPixelLogo)
  return (
    <Show when={cells()}>
      {(logo) => (
        <svg
          class={props.class}
          data-component="pixel-text"
          viewBox={`0 0 ${logo().width} ${logo().height}`}
          role={props.label ? "img" : undefined}
          aria-label={props.label}
          aria-hidden={props.label ? undefined : "true"}
          shape-rendering="crispEdges"
        >
          <path d={logo().path} />
        </svg>
      )}
    </Show>
  )
}

async function rasterise(): Promise<Cells> {
  const image = new Image()
  image.src = source
  await image.decode()
  // Sample at 4× the grid, then keep a cell when enough of it is ink: thin strokes survive.
  const sample = 4
  const width = columns * sample
  const height = Math.round((width * image.naturalHeight) / image.naturalWidth)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return { path: "", cells: [], width: 1, height: 1 }
  context.drawImage(image, 0, 0, width, height)
  const alpha = context.getImageData(0, 0, width, height).data
  const rows = Math.ceil(height / sample)
  const ink = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: columns }, (_, x) => {
      const total = Array.from({ length: sample * sample }, (_, index) => {
        const px = x * sample + (index % sample)
        const py = y * sample + Math.floor(index / sample)
        return py < height ? alpha[(py * width + px) * 4 + 3] : 0
      }).reduce((sum, value) => sum + value, 0)
      return total / (sample * sample * 255) > 0.3
    }),
  )
  const filled = ink.flatMap((row, y) => row.flatMap((on, x) => (on ? [[x, y] as const] : [])))
  const left = Math.min(...filled.map(([x]) => x))
  const top = Math.min(...filled.map(([, y]) => y))
  const cells = filled.map(([x, y]) => [x - left, y - top] as const)
  return {
    path: cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join(""),
    cells,
    width: Math.max(...filled.map(([x]) => x)) - left + 1,
    height: Math.max(...filled.map(([, y]) => y)) - top + 1,
  }
}
