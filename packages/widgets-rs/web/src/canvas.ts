// Draw commands (widgets.md, Canvas) painted on a Canvas2D context. Commands are trusted only for their shape: anything
// malformed is skipped, never thrown.

import type { Resolved } from "./theme.js"
import { TOKENS } from "./theme.js"

export type Command = unknown[]

/** Images `image` commands name, loaded once per source and shared by every canvas of a page. */
export class Images {
  private cache = new Map<string, HTMLImageElement | null>()
  private waiting = new Set<() => void>()

  constructor(private readonly resolve: (src: string) => string | undefined) {}

  /** The loaded image, or undefined while loading (then `onload` runs once it is) or when it can't load. */
  get(src: string, onload: () => void): HTMLImageElement | undefined {
    let img = this.cache.get(src)
    if (img === undefined) {
      const url = this.resolve(src)
      if (!url) {
        this.cache.set(src, null)
        return undefined
      }
      img = new Image()
      img.decoding = "async"
      img.crossOrigin = "anonymous"
      img.referrerPolicy = "no-referrer"
      const done = () => {
        const waiting = [...this.waiting]
        this.waiting.clear()
        for (const f of waiting) f()
      }
      img.onload = done
      img.onerror = () => {
        this.cache.set(src, null)
        done()
      }
      img.src = url
      this.cache.set(src, img)
    }
    if (img === null) return undefined
    if (img.complete && img.naturalWidth > 0) return img
    this.waiting.add(onload)
    return undefined
  }
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN)
const isToken = (s: string): s is (typeof TOKENS)[number] => (TOKENS as readonly string[]).includes(s)

function color(c: unknown, theme: Resolved, fallback: string): string {
  if (typeof c !== "string") return fallback
  if (isToken(c)) return theme[c]
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c)) return c
  return fallback
}

function fillStyle(
  ctx: CanvasRenderingContext2D,
  f: unknown,
  theme: Resolved,
): string | CanvasGradient | undefined {
  if (f === undefined || f === null) return undefined
  if (typeof f === "string") return color(f, theme, theme.text)
  if (typeof f !== "object") return undefined
  const g = f as { linear?: unknown[]; radial?: unknown[]; stops?: unknown[] }
  let grad: CanvasGradient | undefined
  if (Array.isArray(g.linear) && g.linear.length === 4) {
    const [x1, y1, x2, y2] = g.linear.map(num) as [number, number, number, number]
    if ([x1, y1, x2, y2].some(Number.isNaN)) return undefined
    grad = ctx.createLinearGradient(x1, y1, x2, y2)
  } else if (Array.isArray(g.radial) && g.radial.length === 3) {
    const [cx, cy, r] = g.radial.map(num) as [number, number, number]
    if ([cx, cy, r].some(Number.isNaN) || r < 0) return undefined
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  }
  if (!grad || !Array.isArray(g.stops)) return undefined
  for (const s of g.stops) {
    if (!Array.isArray(s)) continue
    const at = num(s[0])
    if (Number.isNaN(at)) continue
    grad.addColorStop(Math.min(1, Math.max(0, at)), color(s[1], theme, theme.text))
  }
  return grad
}

/** Fills then strokes the current path with `paint`. */
function stroke(ctx: CanvasRenderingContext2D, paint: unknown, theme: Resolved, line = false) {
  const p = (paint && typeof paint === "object" ? paint : {}) as {
    fill?: unknown
    stroke?: unknown
    width?: unknown
    cap?: unknown
  }
  const fill = line ? undefined : fillStyle(ctx, p.fill, theme)
  if (fill !== undefined) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  const s = p.stroke !== undefined ? color(p.stroke, theme, theme.text) : line && p.fill === undefined ? theme.text : undefined
  if (s !== undefined) {
    ctx.strokeStyle = s
    const w = num(p.width)
    ctx.lineWidth = Number.isNaN(w) ? 1 : Math.max(0, w)
    ctx.lineCap = p.cap === "round" ? "round" : "butt"
    ctx.stroke()
  }
}

/**
 * Paints `commands` on `ctx` over a cleared `width` x `height` (logical px) at `scale` device pixels per logical one.
 * Images not loaded yet are skipped; `repaint` runs when one arrives.
 */
export function paint(
  ctx: CanvasRenderingContext2D,
  commands: readonly Command[],
  width: number,
  height: number,
  scale: number,
  theme: Resolved,
  images: Images,
  repaint: () => void,
) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.globalAlpha = 1
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  let depth = 0
  for (const c of commands) {
    if (!Array.isArray(c)) continue
    switch (c[0]) {
      case "save":
        if (depth < 64) {
          ctx.save()
          depth++
        }
        break
      case "restore":
        if (depth > 0) {
          ctx.restore()
          depth--
        }
        break
      case "translate": {
        const x = num(c[1]),
          y = num(c[2])
        if (!Number.isNaN(x + y)) ctx.translate(x, y)
        break
      }
      case "rotate": {
        const r = num(c[1])
        if (!Number.isNaN(r)) ctx.rotate(r)
        break
      }
      case "scale": {
        const sx = num(c[1]),
          sy = c[2] === undefined ? sx : num(c[2])
        if (!Number.isNaN(sx + sy)) ctx.scale(sx, sy)
        break
      }
      case "alpha": {
        const a = num(c[1])
        if (!Number.isNaN(a)) ctx.globalAlpha = Math.min(1, Math.max(0, a))
        break
      }
      case "rect": {
        const [x, y, w, h] = [num(c[1]), num(c[2]), num(c[3]), num(c[4])]
        if (Number.isNaN(x + y + w + h)) break
        ctx.beginPath()
        ctx.rect(x, y, w, h)
        stroke(ctx, c[5], theme)
        break
      }
      case "rrect": {
        const [x, y, w, h, r] = [num(c[1]), num(c[2]), num(c[3]), num(c[4]), num(c[5])]
        if (Number.isNaN(x + y + w + h + r)) break
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)))
        stroke(ctx, c[6], theme)
        break
      }
      case "circle": {
        const [x, y, r] = [num(c[1]), num(c[2]), num(c[3])]
        if (Number.isNaN(x + y + r) || r < 0) break
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        stroke(ctx, c[4], theme)
        break
      }
      case "line": {
        const [x1, y1, x2, y2] = [num(c[1]), num(c[2]), num(c[3]), num(c[4])]
        if (Number.isNaN(x1 + y1 + x2 + y2)) break
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        stroke(ctx, c[5], theme, true)
        break
      }
      case "path": {
        if (!Array.isArray(c[1])) break
        ctx.beginPath()
        for (const s of c[1] as unknown[]) {
          if (!Array.isArray(s)) continue
          const n = s.slice(1).map(num)
          if (n.some(Number.isNaN)) continue
          switch (s[0]) {
            case "M":
              if (n.length >= 2) ctx.moveTo(n[0]!, n[1]!)
              break
            case "L":
              if (n.length >= 2) ctx.lineTo(n[0]!, n[1]!)
              break
            case "Q":
              if (n.length >= 4) ctx.quadraticCurveTo(n[0]!, n[1]!, n[2]!, n[3]!)
              break
            case "C":
              if (n.length >= 6) ctx.bezierCurveTo(n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!)
              break
            case "Z":
              ctx.closePath()
              break
          }
        }
        stroke(ctx, c[2], theme)
        break
      }
      case "text": {
        const [x, y] = [num(c[1]), num(c[2])]
        if (Number.isNaN(x + y) || c[3] === undefined) break
        const st = (c[4] && typeof c[4] === "object" ? c[4] : {}) as {
          size?: unknown
          weight?: unknown
          align?: unknown
          color?: unknown
          mono?: unknown
        }
        const size = Number.isNaN(num(st.size)) ? 13 : Math.max(1, Math.min(400, num(st.size)))
        const weight = [400, 500, 600, 700].includes(st.weight as number) ? (st.weight as number) : 400
        ctx.font = `${weight} ${size}px ${st.mono === true ? theme.mono : theme.font}`
        ctx.textAlign = st.align === "center" ? "center" : st.align === "right" ? "right" : "left"
        ctx.textBaseline = "alphabetic"
        ctx.fillStyle = color(st.color, theme, theme.text)
        ctx.fillText(String(c[3]), x, y)
        break
      }
      case "image": {
        const [x, y, w, h] = [num(c[2]), num(c[3]), num(c[4]), num(c[5])]
        if (typeof c[1] !== "string" || Number.isNaN(x + y + w + h)) break
        const img = images.get(c[1], repaint)
        if (img) ctx.drawImage(img, x, y, w, h)
        break
      }
    }
  }
  while (depth-- > 0) ctx.restore()
  ctx.restore()
}
