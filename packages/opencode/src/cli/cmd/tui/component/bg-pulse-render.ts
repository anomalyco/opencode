import { OptimizedBuffer, RGBA, TextAttributes } from "@opentui/core"
import { go } from "@/cli/logo"

const PERIOD = 4600
const RINGS = 3
const WIDTH = 3.8
const TAIL = 9.5
const AMP = 0.55
const TAIL_AMP = 0.16
const BREATH_AMP = 0.05
const BREATH_SPEED = 0.0008
// Offset so the bg ring emits from the estimated GO center when the logo shimmer peaks.
const PHASE_OFFSET = 0.29
const LOGO_GAP = 1
const LOGO_TOP_BIAS = -1
const LOGO_LEFT_WIDTH = go.left[0]?.length ?? 0
const LOGO_LINES = go.left.map((line, index) => line + " ".repeat(LOGO_GAP) + go.right[index])
const LOGO_WIDTH = LOGO_LINES[0]?.length ?? 0
const LOGO_HEIGHT = LOGO_LINES.length
const SPACE = " ".codePointAt(0)!
const TOP_HALF = "▀".codePointAt(0)!
const FULL_BLOCK = "█".codePointAt(0)!
const RING_SCALE = 1 / RINGS
const TAIL_SCALE = 1 / TAIL
const LOGO_REACH = Math.hypot(LOGO_WIDTH, LOGO_HEIGHT * 2) + 3

const enum LogoCellKind {
  Background,
  Top,
  ShadowTop,
  Solid,
  Char,
}

type LogoTemplateCell = {
  x: number
  y: number
  kind: LogoCellKind
  charCode: number
  attributes: number
  topDist: number
  bottomDist: number
}

const LOGO_TEMPLATE: LogoTemplateCell[] = LOGO_LINES.flatMap((line, y) =>
  Array.from(line)
    .map((char, x) => {
      if (char === " ") return
      const kind =
        char === "_"
          ? LogoCellKind.Background
          : char === "^"
            ? LogoCellKind.Top
            : char === "~"
              ? LogoCellKind.ShadowTop
              : char === "█"
                ? LogoCellKind.Solid
                : LogoCellKind.Char
      return {
        x,
        y,
        kind,
        charCode: char.codePointAt(0) ?? SPACE,
        attributes: x > LOGO_LEFT_WIDTH ? TextAttributes.BOLD : 0,
        topDist: Math.hypot(x + 0.5 - LOGO_WIDTH / 2, y * 2 - LOGO_HEIGHT),
        bottomDist: Math.hypot(x + 0.5 - LOGO_WIDTH / 2, y * 2 + 1 - LOGO_HEIGHT),
      }
    })
    .filter((cell): cell is LogoTemplateCell => !!cell),
)

export type Rgb = [number, number, number]

export type GoUpsellArtRenderOptions = {
  deltaTime?: number
  rgb?: boolean
  cache?: boolean
}

const CACHE_FRAME_COUNT = Math.round(PERIOD / (1000 / 30))
const CACHE_FRAMES_PER_RENDER = 1

export function toRgb(color: RGBA): Rgb {
  const [r, g, b] = color.toInts()
  return [r, g, b]
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, n))
}

function writeRgb(buffer: Uint16Array, offset: number, r: number, g: number, b: number, a = 255) {
  buffer[offset] = r
  buffer[offset + 1] = g
  buffer[offset + 2] = b
  buffer[offset + 3] = a
}

function mixChannel(base: number, overlay: number, alpha: number) {
  return Math.round(base + (overlay - base) * clamp(alpha))
}

function writeLogoTint(buffer: Uint16Array, offset: number, base: Rgb, primary: Rgb, primaryMix: number, peakMix: number) {
  const p = clamp(primaryMix)
  const q = clamp(peakMix)
  const r = mixChannel(mixChannel(base[0], primary[0], p), 255, q)
  const g = mixChannel(mixChannel(base[1], primary[1], p), 255, q)
  const b = mixChannel(mixChannel(base[2], primary[2], p), 255, q)
  writeRgb(buffer, offset, r, g, b)
}

function sameRgb(a: Rgb, b: Rgb) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

export class GoUpsellArtPainter {
  private panelRgb: Rgb = [0, 0, 0]
  private primaryRgb: Rgb = [255, 255, 255]
  private logoBaseRgb: Rgb = [180, 180, 180]
  private elapsed = 0
  private distances = new Float32Array(0)
  private edgeFalloff = new Float32Array(0)
  private geometryWidth = 0
  private geometryHeight = 0
  private reach = 1
  private logoX = 0
  private logoY = 0
  private logoIndexes = new Int32Array(0)
  private logoRgb: boolean | undefined
  private pulsePeak = 0
  private pulsePrimary = 0
  private cacheDirty = true
  private frameCache: Array<{ fg: Uint16Array; bg: Uint16Array }> = []
  private cacheBuildIndex = 0

  setBackgroundPanel(value: RGBA | Rgb | undefined) {
    if (!value) return false
    const next = value instanceof RGBA ? toRgb(value) : value
    if (sameRgb(this.panelRgb, next)) return false
    this.panelRgb = next
    this.invalidateCache()
    return true
  }

  setLogoBase(value: RGBA | Rgb | undefined) {
    if (!value) return false
    const next = value instanceof RGBA ? toRgb(value) : value
    if (sameRgb(this.logoBaseRgb, next)) return false
    this.logoBaseRgb = next
    this.invalidateCache()
    return true
  }

  setPrimary(value: RGBA | Rgb | undefined) {
    if (!value) return false
    const next = value instanceof RGBA ? toRgb(value) : value
    if (sameRgb(this.primaryRgb, next)) return false
    this.primaryRgb = next
    this.invalidateCache()
    return true
  }

  render(frameBuffer: OptimizedBuffer, options: GoUpsellArtRenderOptions = {}) {
    const rgb = options.rgb === true
    this.elapsed = (this.elapsed + (options.deltaTime ?? 0)) % PERIOD
    this.rebuildGeometry(frameBuffer, rgb)
    if (options.cache !== false) {
      this.drawCached(frameBuffer, rgb)
      return
    }
    this.drawBackground(frameBuffer, this.elapsed)
    this.drawLogo(frameBuffer, this.elapsed, rgb)
  }

  private invalidateCache() {
    this.cacheDirty = true
    this.cacheBuildIndex = 0
    this.frameCache = []
  }

  private rebuildGeometry(frameBuffer: OptimizedBuffer, rgb: boolean) {
    const width = frameBuffer.width
    const height = frameBuffer.height
    const geometryChanged = width !== this.geometryWidth || height !== this.geometryHeight
    const logoTemplateChanged = this.logoRgb !== rgb
    if (!geometryChanged && !logoTemplateChanged) return

    if (geometryChanged) {
      this.geometryWidth = width
      this.geometryHeight = height
      this.logoX = Math.max(0, Math.floor((width - LOGO_WIDTH) / 2))
      this.logoY = Math.max(
        0,
        Math.min(Math.max(0, height - LOGO_HEIGHT), Math.round((height - LOGO_HEIGHT) / 2) + LOGO_TOP_BIAS),
      )

      const centerX = this.logoX + LOGO_WIDTH / 2
      const centerY = this.logoY + LOGO_HEIGHT / 2
      this.reach = Math.hypot(Math.max(centerX, width - centerX), Math.max(centerY, height - centerY) * 2) + TAIL
      this.distances = new Float32Array(width * height)
      this.edgeFalloff = new Float32Array(width * height)

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x
          const dist = Math.hypot(x + 0.5 - centerX, (y + 0.5 - centerY) * 2)
          this.distances[index] = dist
          this.edgeFalloff[index] = Math.max(0, 1 - (dist / (this.reach * 0.85)) ** 2)
        }
      }
    }

    this.logoRgb = rgb
    this.invalidateCache()
    this.rebuildCellTemplate(frameBuffer, rgb)
  }

  private drawCached(frameBuffer: OptimizedBuffer, rgb: boolean) {
    if (this.cacheDirty) this.startFrameCache(frameBuffer, rgb)
    if (this.cacheBuildIndex < CACHE_FRAME_COUNT) {
      this.buildFrameCache(frameBuffer, rgb)
      this.drawBackground(frameBuffer, this.elapsed)
      this.drawLogo(frameBuffer, this.elapsed, rgb)
      return
    }

    const frame = this.frameCache[Math.floor((this.elapsed / PERIOD) * CACHE_FRAME_COUNT) % CACHE_FRAME_COUNT]
    if (frame) {
      frameBuffer.buffers.fg.set(frame.fg)
      frameBuffer.buffers.bg.set(frame.bg)
    }
  }

  private startFrameCache(frameBuffer: OptimizedBuffer, rgb: boolean) {
    this.frameCache = []
    this.cacheBuildIndex = 0
    this.rebuildCellTemplate(frameBuffer, rgb)
    this.cacheDirty = false
  }

  private buildFrameCache(frameBuffer: OptimizedBuffer, rgb: boolean) {
    const end = Math.min(CACHE_FRAME_COUNT, this.cacheBuildIndex + CACHE_FRAMES_PER_RENDER)
    for (; this.cacheBuildIndex < end; this.cacheBuildIndex++) {
      const t = (this.cacheBuildIndex / CACHE_FRAME_COUNT) * PERIOD
      this.drawBackground(frameBuffer, t)
      this.drawLogo(frameBuffer, t, rgb)
      this.frameCache.push({
        fg: new Uint16Array(frameBuffer.buffers.fg),
        bg: new Uint16Array(frameBuffer.buffers.bg),
      })
    }
  }

  private rebuildCellTemplate(frameBuffer: OptimizedBuffer, rgb: boolean) {
    const buffers = frameBuffer.buffers
    buffers.char.fill(SPACE)
    buffers.attributes.fill(0)

    if (this.geometryWidth < LOGO_WIDTH || this.geometryHeight < LOGO_HEIGHT) {
      this.logoIndexes = new Int32Array(0)
      return
    }

    this.logoIndexes = new Int32Array(LOGO_TEMPLATE.length)
    for (let i = 0; i < LOGO_TEMPLATE.length; i++) {
      const cell = LOGO_TEMPLATE[i]!
      const index = (this.logoY + cell.y) * this.geometryWidth + this.logoX + cell.x
      this.logoIndexes[i] = index
      buffers.attributes[index] = cell.attributes
      buffers.char[index] =
        cell.kind === LogoCellKind.Background
          ? SPACE
          : cell.kind === LogoCellKind.Top || cell.kind === LogoCellKind.ShadowTop
            ? TOP_HALF
            : cell.kind === LogoCellKind.Solid
              ? rgb
                ? TOP_HALF
                : FULL_BLOCK
              : cell.charCode
    }
  }

  private drawBackground(frameBuffer: OptimizedBuffer, t: number) {
    const buffers = frameBuffer.buffers
    const fg = buffers.fg
    const bg = buffers.bg
    const distances = this.distances
    const edgeFalloff = this.edgeFalloff
    const baseR = this.panelRgb[0]
    const baseG = this.panelRgb[1]
    const baseB = this.panelRgb[2]
    const deltaR = this.primaryRgb[0] - baseR
    const deltaG = this.primaryRgb[1] - baseG
    const deltaB = this.primaryRgb[2] - baseB
    const breath = (0.5 + 0.5 * Math.sin(t * BREATH_SPEED)) * BREATH_AMP

    const phase0 = (t / PERIOD - PHASE_OFFSET + 1) % 1
    const phase1 = (t / PERIOD + 1 / RINGS - PHASE_OFFSET + 1) % 1
    const phase2 = (t / PERIOD + 2 / RINGS - PHASE_OFFSET + 1) % 1
    const envelope0 = Math.sin(phase0 * Math.PI)
    const envelope1 = Math.sin(phase1 * Math.PI)
    const envelope2 = Math.sin(phase2 * Math.PI)
    const eased0 = envelope0 * envelope0 * (3 - 2 * envelope0)
    const eased1 = envelope1 * envelope1 * (3 - 2 * envelope1)
    const eased2 = envelope2 * envelope2 * (3 - 2 * envelope2)
    const head0 = phase0 * this.reach
    const head1 = phase1 * this.reach
    const head2 = phase2 * this.reach

    for (let index = 0; index < distances.length; index++) {
      const dist = distances[index]
      const delta0 = dist - head0
      const abs0 = delta0 < 0 ? -delta0 : delta0
      const crest0 = abs0 < WIDTH ? 0.5 + 0.5 * Math.cos((delta0 / WIDTH) * Math.PI) : 0
      const tail0 = delta0 < 0 && delta0 > -TAIL ? (1 + delta0 * TAIL_SCALE) ** 2.3 : 0

      const delta1 = dist - head1
      const abs1 = delta1 < 0 ? -delta1 : delta1
      const crest1 = abs1 < WIDTH ? 0.5 + 0.5 * Math.cos((delta1 / WIDTH) * Math.PI) : 0
      const tail1 = delta1 < 0 && delta1 > -TAIL ? (1 + delta1 * TAIL_SCALE) ** 2.3 : 0

      const delta2 = dist - head2
      const abs2 = delta2 < 0 ? -delta2 : delta2
      const crest2 = abs2 < WIDTH ? 0.5 + 0.5 * Math.cos((delta2 / WIDTH) * Math.PI) : 0
      const tail2 = delta2 < 0 && delta2 > -TAIL ? (1 + delta2 * TAIL_SCALE) ** 2.3 : 0

      const level =
        (crest0 * AMP + tail0 * TAIL_AMP) * eased0 +
        (crest1 * AMP + tail1 * TAIL_AMP) * eased1 +
        (crest2 * AMP + tail2 * TAIL_AMP) * eased2
      const rawStrength = (level * RING_SCALE + breath) * edgeFalloff[index]
      const strength = (rawStrength > 1 ? 1 : rawStrength) * 0.7
      const offset = index * 4
      const r = Math.round(baseR + deltaR * strength)
      const g = Math.round(baseG + deltaG * strength)
      const b = Math.round(baseB + deltaB * strength)
      bg[offset] = fg[offset] = r
      bg[offset + 1] = fg[offset + 1] = g
      bg[offset + 2] = fg[offset + 2] = b
      bg[offset + 3] = fg[offset + 3] = 255
    }
  }

  private setLogoPulse(dist: number, head0: number, eased0: number, head1: number, eased1: number) {
    let peak = 0.04
    let primary = 0

    const delta0 = dist - head0
    const core0 = Math.exp(-(Math.abs(delta0 / 1.2) ** 1.8))
    const soft0 = Math.exp(-(Math.abs(delta0 / 7) ** 1.6))
    const tail0 = delta0 < 0 && delta0 > -7 ? (1 + delta0 / 7) ** 2.6 : 0
    peak += core0 * 0.65 * eased0
    primary += (soft0 * 0.16 + tail0 * 0.22) * eased0

    const delta1 = dist - head1
    const core1 = Math.exp(-(Math.abs(delta1 / 1.2) ** 1.8))
    const soft1 = Math.exp(-(Math.abs(delta1 / 7) ** 1.6))
    const tail1 = delta1 < 0 && delta1 > -7 ? (1 + delta1 / 7) ** 2.6 : 0
    peak += core1 * 0.65 * eased1
    primary += (soft1 * 0.16 + tail1 * 0.22) * eased1

    this.pulsePeak = peak > 1 ? 1 : peak
    this.pulsePrimary = primary > 1 ? 1 : primary
  }

  private drawLogo(frameBuffer: OptimizedBuffer, t: number, rgb: boolean) {
    if (this.logoIndexes.length === 0) return

    const buffers = frameBuffer.buffers
    const fg = buffers.fg
    const bg = buffers.bg
    const shadow: Rgb = [
      mixChannel(this.panelRgb[0], this.logoBaseRgb[0], 0.25),
      mixChannel(this.panelRgb[1], this.logoBaseRgb[1], 0.25),
      mixChannel(this.panelRgb[2], this.logoBaseRgb[2], 0.25),
    ]
    const phase0 = (t / PERIOD) % 1
    const phase1 = (t / PERIOD + 0.5) % 1
    const envelope0 = Math.sin(phase0 * Math.PI)
    const envelope1 = Math.sin(phase1 * Math.PI)
    const eased0 = envelope0 * envelope0 * (3 - 2 * envelope0)
    const eased1 = envelope1 * envelope1 * (3 - 2 * envelope1)
    const head0 = phase0 * LOGO_REACH
    const head1 = phase1 * LOGO_REACH

    for (let i = 0; i < LOGO_TEMPLATE.length; i++) {
      const cell = LOGO_TEMPLATE[i]!
      const index = this.logoIndexes[i]!
      const offset = index * 4
      this.setLogoPulse(cell.topDist, head0, eased0, head1, eased1)
      const topPeak = this.pulsePeak
      const topPrimary = this.pulsePrimary
      this.setLogoPulse(cell.bottomDist, head0, eased0, head1, eased1)
      const bottomPeak = this.pulsePeak
      const bottomPrimary = this.pulsePrimary

      if (cell.kind === LogoCellKind.Background) {
        writeLogoTint(bg, offset, shadow, this.primaryRgb, 0, Math.max(topPeak, bottomPeak) * 0.18)
        continue
      }

      if (cell.kind === LogoCellKind.Top) {
        writeLogoTint(fg, offset, this.logoBaseRgb, this.primaryRgb, topPrimary, topPeak)
        writeLogoTint(bg, offset, shadow, this.primaryRgb, 0, bottomPeak * 0.18)
        continue
      }

      if (cell.kind === LogoCellKind.ShadowTop) {
        writeLogoTint(fg, offset, shadow, this.primaryRgb, 0, topPeak * 0.18)
        continue
      }

      if (cell.kind === LogoCellKind.Solid && rgb) {
        writeLogoTint(fg, offset, this.logoBaseRgb, this.primaryRgb, topPrimary, topPeak)
        writeLogoTint(bg, offset, this.logoBaseRgb, this.primaryRgb, bottomPrimary, bottomPeak)
        continue
      }

      writeLogoTint(
        fg,
        offset,
        this.logoBaseRgb,
        this.primaryRgb,
        (topPrimary + bottomPrimary) / 2,
        (topPeak + bottomPeak) / 2,
      )
    }
  }
}
