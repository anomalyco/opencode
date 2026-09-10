import {
  applyChromaticAberration,
  OptimizedBuffer,
  Renderable,
  RGBA,
  TargetChannel,
  type RenderableOptions,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { For, Show } from "solid-js"

// The shimmer field is precomputed once into a seamless tile; animation just slides an
// offset into it, so steady-state frames do array lookups only (no trig). Updates are
// throttled well below the renderer's live frame rate — ambient drift doesn't need 60fps,
// and each skipped frame skips a whole-app render plus the terminal diff/flush.
const TILE = 96
const TICK_MS = 90
// Cells per tick the pattern drifts at speed 1 (~2 columns/second).
const DRIFT_PER_TICK = 0.18
// Strengths quantize to this many levels so a cell's final color changes only when it
// crosses a level, keeping the frame-to-frame terminal diff small.
const LEVELS = 5

export type ShimmerParams = {
  enabled: number
  strength: number
  keep: number
  threshold: number
  softness: number
  speed: number
  density: number
  aberration: number
  red: number
  green: number
  blue: number
}

export const SHIMMER_DEFAULTS: ShimmerParams = {
  enabled: 0,
  strength: 0.8,
  keep: 0.25,
  threshold: 0.55,
  softness: 0.3,
  speed: 1,
  density: 1,
  aberration: 1,
  red: 150,
  green: 190,
  blue: 255,
}

export const SHIMMER_CONTROLS: {
  key: keyof ShimmerParams
  label: string
  min: number
  max: number
  step: number
  digits: number
}[] = [
  { key: "enabled", label: "Enabled", min: 0, max: 1, step: 1, digits: 0 },
  { key: "strength", label: "Strength", min: 0, max: 1, step: 0.05, digits: 2 },
  { key: "keep", label: "Keep", min: 0, max: 1, step: 0.05, digits: 2 },
  { key: "threshold", label: "Threshold", min: 0.2, max: 0.95, step: 0.01, digits: 2 },
  { key: "softness", label: "Softness", min: 0.05, max: 1, step: 0.01, digits: 2 },
  { key: "speed", label: "Speed", min: 0, max: 3, step: 0.05, digits: 2 },
  { key: "density", label: "Density", min: 0.3, max: 3, step: 0.05, digits: 2 },
  { key: "aberration", label: "Aberration", min: 0, max: 4, step: 0.25, digits: 2 },
  { key: "red", label: "Red", min: 0, max: 255, step: 5, digits: 0 },
  { key: "green", label: "Green", min: 0, max: 255, step: 5, digits: 0 },
  { key: "blue", label: "Blue", min: 0, max: 255, step: 5, digits: 0 },
]

// Foreground shimmer via color matrices: instead of compositing tint boxes over the app,
// this renderable rewrites the text colors already in the frame buffer. It renders above the
// app content, so the buffer it receives holds every glyph below it; one colorMatrix call
// per update pulls each cell's foreground toward the tint color, with per-cell strength
// sampled from the precomputed interference tile at the current drift offset.
// TargetChannel.FG leaves backgrounds untouched, so only the text shimmers. The matrix
// blends `keep` of the original color with `1 - keep` of the tint (foreground alpha is 1,
// so the fourth column acts as the additive tint term).
export class ShimmerOverlayRenderable extends Renderable {
  private offset = 0
  private params: ShimmerParams = { ...SHIMMER_DEFAULTS }
  private matrix = new Float32Array(16)
  private mask = new Float32Array(0)
  private tile = new Float32Array(TILE * TILE)
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(ctx: RenderContext, options: RenderableOptions<ShimmerOverlayRenderable>) {
    super(ctx, { ...options, live: false })
    this.rebuildMatrix()
    this.rebuildTile()
    this.syncTimer()
  }

  setParams(value: ShimmerParams) {
    // The App unmounts the overlay while disabled (so it never blocks mouse hit-testing);
    // a stale ref may point at a destroyed instance when params change while unmounted.
    if (this.isDestroyed) return
    const previous = this.params
    this.params = value
    this.rebuildMatrix()
    if (
      value.threshold !== previous.threshold ||
      value.softness !== previous.softness ||
      value.density !== previous.density
    )
      this.rebuildTile()
    this.syncTimer()
    this.requestRender()
  }

  private syncTimer() {
    const active = this.params.enabled >= 0.5
    if (active && this.timer === undefined) {
      this.timer = setInterval(() => {
        this.offset = (this.offset + this.params.speed * DRIFT_PER_TICK) % TILE
        this.requestRender()
      }, TICK_MS)
    }
    if (!active && this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  protected override destroySelf(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    super.destroySelf()
  }

  private rebuildMatrix() {
    const p = this.params
    const tint = 1 - p.keep
    // Row-major 4x4: output = keep * channel + tint target (via the alpha column, since
    // foreground alpha is 1). Alpha row stays identity.
    this.matrix.fill(0)
    this.matrix[0] = p.keep
    this.matrix[3] = (p.red / 255) * tint
    this.matrix[5] = p.keep
    this.matrix[7] = (p.green / 255) * tint
    this.matrix[10] = p.keep
    this.matrix[11] = (p.blue / 255) * tint
    this.matrix[15] = 1
  }

  // Bake the interference field into a seamless tile: wave cycle counts are integers, so
  // the pattern wraps with no seam and animation is a pure offset into this array.
  private rebuildTile() {
    const p = this.params
    const cycles = (base: number) => Math.max(1, Math.round(base * p.density))
    const a = cycles(3)
    const b = cycles(2)
    const c = cycles(1)
    const step = (Math.PI * 2) / TILE
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const field =
          Math.sin((a * x + c * y) * step + 0.7) +
          Math.sin((b * x - b * y) * step + 2.1) +
          Math.sin((c * x + a * y) * step + 4.2)
        const n = field / 6 + 0.5
        const v = (n - p.threshold) / p.softness
        const clamped = v <= 0 ? 0 : v >= 1 ? 1 : v
        const shaped = clamped * clamped * (3 - 2 * clamped)
        this.tile[y * TILE + x] = Math.round(shaped * LEVELS) / LEVELS
      }
    }
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const p = this.params
    if (p.enabled < 0.5 || !this.visible || this.isDestroyed || this.width <= 0 || this.height <= 0) return
    // Lens-fringe post-process: offsets red/blue foreground channels horizontally, growing
    // from zero at screen center to `aberration` cells at the edges. Backgrounds untouched.
    if (p.aberration > 0) applyChromaticAberration(buffer, p.aberration)
    if (p.strength <= 0) return
    if (this.mask.length < this.width * this.height * 3) this.mask = new Float32Array(this.width * this.height * 3)
    const ox = Math.floor(this.offset)
    const oy = Math.floor(this.offset * 0.37)
    let count = 0
    for (let j = 0; j < this.height; j++) {
      // One row spans ~2 columns of visual space; sampling the tile at 2j keeps the pools
      // visually round instead of vertically stretched.
      const row = (((j * 2 + oy) % TILE) + TILE) % TILE
      const base = row * TILE
      for (let i = 0; i < this.width; i++) {
        const cell = this.tile[base + ((((i + ox) % TILE) + TILE) % TILE)]
        if (cell === 0) continue
        this.mask[count] = this.screenX + i
        this.mask[count + 1] = this.screenY + j
        this.mask[count + 2] = cell
        count += 3
      }
    }
    if (count === 0) return
    buffer.colorMatrix(this.matrix, this.mask.subarray(0, count), p.strength, TargetChannel.FG)
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    shimmer_overlay: typeof ShimmerOverlayRenderable
  }
}

extend({ shimmer_overlay: ShimmerOverlayRenderable })

export function ShimmerOverlay(props: {
  width: number
  height: number
  ref?: (renderable: ShimmerOverlayRenderable) => void
}) {
  return (
    <shimmer_overlay
      ref={props.ref}
      position="absolute"
      left={0}
      top={0}
      width={props.width}
      height={props.height}
      zIndex={900}
    />
  )
}

const BAR_WIDTH = 12

function formatRow(control: (typeof SHIMMER_CONTROLS)[number], value: number, selected: boolean) {
  const filled = Math.round(((value - control.min) / (control.max - control.min)) * BAR_WIDTH)
  const bar = "█".repeat(Math.max(0, Math.min(BAR_WIDTH, filled))).padEnd(BAR_WIDTH, "·")
  const display = control.key === "enabled" ? (value >= 0.5 ? "on" : "off") : value.toFixed(control.digits)
  return `${selected ? "▸ " : "  "}${control.label.padEnd(10)}${bar} ${display}`
}

export function ShimmerTuner(props: { open: boolean; selected: number; params: ShimmerParams }) {
  return (
    <Show when={props.open}>
      <box
        position="absolute"
        top={1}
        left={2}
        zIndex={1100}
        flexDirection="column"
        backgroundColor={RGBA.fromInts(16, 20, 30, 235)}
        border
        borderColor={RGBA.fromInts(90, 130, 200)}
        title="fg shimmer"
        paddingLeft={1}
        paddingRight={1}
      >
        <For each={SHIMMER_CONTROLS}>
          {(control, index) => (
            <text
              fg={index() === props.selected ? RGBA.fromInts(255, 255, 255) : RGBA.fromInts(150, 160, 180)}
              content={formatRow(control, props.params[control.key], index() === props.selected)}
            />
          )}
        </For>
        <text fg={RGBA.fromInts(110, 120, 145)} content="↑↓ select  ←→ adjust  shift ×5  esc close" />
        <text fg={RGBA.fromInts(110, 120, 145)} content="ctrl+r effect  ctrl+alt+r panel" />
      </box>
    </Show>
  )
}
