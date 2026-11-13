import { onCleanup, onMount } from "solid-js"
import { fontContent, letters, modules, type Letter } from "~/lib/font-content"
import { Plate, prefersReducedMotion } from "./plate"

type Ripple = { x: number; y: number; born: number; strength: number; life: number; speed: number }
type Palette = { bg: string; faint: string; ink: string; blue: string }

// The word spelled across the middle of the resting field.
const ACCENT = "opencode"

/**
 * Plate: a field of the six letters on a canvas. It rests as a quiet grid; the pointer leaves a
 * trail of small ripples and a click drops a pulse. Tiles a ripple reaches turn over to the next
 * letters, darken, turn blue and finally invert, then settle back. Flat colours on whole pixels.
 */
export function Field() {
  let root!: HTMLDivElement
  let canvas!: HTMLCanvasElement

  onMount(() => {
    const context = canvas.getContext("2d")!
    const reduced = prefersReducedMotion()
    let dpr = 1
    let m = 3
    let cols = 0
    let rows = 0
    let pitchX = 0
    let pitchY = 0
    let offsetX = 0
    let offsetY = 0
    let base = new Uint8Array(0)
    let accent = new Int8Array(0)
    let energy = new Float32Array(0)
    let ripples: Ripple[] = []
    let sprites = new Map<string, HTMLCanvasElement>()
    let palette: Palette | undefined
    let frame = 0
    let visible = false
    let pointer: { x: number; y: number } | undefined
    let lastTrail = 0

    const hash = (index: number) => {
      const value = Math.sin(index * 127.1 + 311.7) * 43758.5453
      return value - Math.floor(value)
    }

    // The theme's colours, resolved: CSS maps them onto these properties of the canvas.
    const readPalette = (): Palette => {
      const style = getComputedStyle(canvas)
      return { bg: style.backgroundColor, ink: style.color, blue: style.borderTopColor, faint: style.outlineColor }
    }

    // Every letter in every state, drawn once at device pixels and stamped from then on.
    const buildSprites = () => {
      sprites = new Map()
      if (!palette) return
      for (const letter of letters) {
        for (const state of ["faint", "ink", "blue", "invert"] as const) {
          const sprite = document.createElement("canvas")
          const invert = state === "invert"
          sprite.width = invert ? pitchX : 4 * m
          sprite.height = invert ? pitchY : 7 * m
          const draw = sprite.getContext("2d")!
          const ox = invert ? Math.floor((pitchX - 4 * m) / 2) : 0
          const oy = invert ? Math.floor((pitchY - 7 * m) / 2) : 0
          if (invert) {
            draw.fillStyle = palette.blue
            draw.fillRect(0, 0, pitchX, pitchY)
          }
          draw.fillStyle = invert
            ? palette.bg
            : state === "faint"
              ? palette.faint
              : state === "ink"
                ? palette.ink
                : palette.blue
          modules[letter].forEach((row, y) =>
            [...row].forEach((cell, x) => {
              if (cell === "#") draw.fillRect(ox + x * m, oy + y * m, m, m)
            }),
          )
          sprites.set(`${letter}${state}`, sprite)
        }
      }
    }

    const layout = () => {
      dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
      const width = root.clientWidth
      const small = width < 640
      // Whole device pixels per module, so every edge is crisp.
      m = (small ? 2 : 3) * dpr
      pitchX = 5 * m
      pitchY = 9 * m
      rows = small ? 22 : 18
      cols = Math.floor((width * dpr) / pitchX)
      canvas.width = width * dpr
      canvas.height = rows * pitchY
      canvas.style.width = `${width}px`
      canvas.style.height = `${(rows * pitchY) / dpr}px`
      offsetX = Math.floor((canvas.width - cols * pitchX) / 2) + Math.floor(m / 2)
      offsetY = m
      base = Uint8Array.from({ length: cols * rows }, (_, index) => Math.floor(hash(index) * 6))
      accent = new Int8Array(cols * rows).fill(-1)
      const row = Math.floor(rows / 2)
      const start = Math.floor(cols / 2) - Math.floor(ACCENT.length / 2)
      ;[...ACCENT].forEach((letter, index) => {
        if (start + index >= 0 && start + index < cols)
          accent[row * cols + start + index] = letters.indexOf(letter as Letter)
      })
      energy = new Float32Array(cols * rows)
      palette = readPalette()
      buildSprites()
    }

    const draw = () => {
      if (!palette) return
      context.fillStyle = palette.bg
      context.fillRect(0, 0, canvas.width, canvas.height)
      for (let index = 0; index < energy.length; index++) {
        const e = energy[index]
        const fixed = accent[index]
        const shift = e > 0.12 ? Math.ceil(e * 6) : 0
        const letter = letters[((fixed >= 0 ? fixed : base[index]) + (fixed >= 0 && e < 0.35 ? 0 : shift)) % 6]
        const state = e > 0.66 ? "invert" : e > 0.36 ? "blue" : e > 0.12 || fixed >= 0 ? "ink" : "faint"
        const sprite = sprites.get(`${letter}${state}`)
        if (!sprite) continue
        const x = offsetX + (index % cols) * pitchX
        const y = offsetY + Math.floor(index / cols) * pitchY
        if (state === "invert")
          context.drawImage(sprite, x - Math.floor((pitchX - 4 * m) / 2), y - Math.floor((pitchY - 7 * m) / 2))
        else context.drawImage(sprite, x, y)
      }
    }

    // Energy at every tile: the strongest ring of any live ripple, plus a halo round the pointer.
    const simulate = (now: number) => {
      ripples = ripples.filter((ripple) => now - ripple.born < ripple.life)
      energy.fill(0)
      for (const ripple of ripples) {
        const age = now - ripple.born
        const radius = (age / 1000) * ripple.speed
        const amplitude = ripple.strength * (1 - age / ripple.life)
        const reach = radius + 2
        const c0 = Math.max(0, Math.floor(ripple.x - reach))
        const c1 = Math.min(cols - 1, Math.ceil(ripple.x + reach))
        const r0 = Math.max(0, Math.floor(ripple.y - reach))
        const r1 = Math.min(rows - 1, Math.ceil(ripple.y + reach))
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const distance = Math.hypot(c - ripple.x, (r - ripple.y) * 1.8)
            const ring = Math.max(0, 1 - Math.abs(distance - radius) / 1.6)
            const index = r * cols + c
            energy[index] = Math.max(energy[index], ring * amplitude)
          }
        }
      }
      if (pointer) halo(pointer.x, pointer.y)
    }

    const halo = (px: number, py: number) => {
      for (let r = Math.max(0, Math.floor(py - 3)); r <= Math.min(rows - 1, Math.ceil(py + 3)); r++) {
        for (let c = Math.max(0, Math.floor(px - 5)); c <= Math.min(cols - 1, Math.ceil(px + 5)); c++) {
          const distance = Math.hypot(c - px, (r - py) * 1.8)
          const index = r * cols + c
          energy[index] = Math.max(energy[index], Math.max(0, 1 - distance / 4.5) * 0.9)
        }
      }
    }

    const tick = (now: number) => {
      frame = 0
      simulate(now)
      draw()
      if (visible && (ripples.length || pointer)) frame = requestAnimationFrame(tick)
    }

    const wake = () => {
      if (reduced) {
        energy.fill(0)
        if (pointer) halo(pointer.x, pointer.y)
        draw()
        return
      }
      if (!frame && visible) frame = requestAnimationFrame(tick)
    }

    const toTile = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: ((event.clientX - rect.left) * dpr - offsetX) / pitchX - 0.5,
        y: ((event.clientY - rect.top) * dpr - offsetY) / pitchY - 0.5,
      }
    }

    const move = (event: PointerEvent) => {
      pointer = toTile(event)
      const now = performance.now()
      if (!reduced && now - lastTrail > 45) {
        lastTrail = now
        ripples.push({ ...pointer, born: now, strength: 0.7, life: 700, speed: 9 })
      }
      wake()
    }
    const leave = () => {
      pointer = undefined
      wake()
    }
    const pulse = (event: PointerEvent) => {
      const at = toTile(event)
      if (event.pointerType !== "mouse") pointer = undefined
      if (!reduced) ripples.push({ ...at, born: performance.now(), strength: 1, life: 1800, speed: 26 })
      wake()
    }

    canvas.addEventListener("pointermove", move)
    canvas.addEventListener("pointerleave", leave)
    canvas.addEventListener("pointercancel", leave)
    canvas.addEventListener("pointerdown", pulse)

    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) wake()
    })
    visibility.observe(root)

    let width = root.clientWidth
    const resize = new ResizeObserver(() => {
      if (root.clientWidth === width) return
      width = root.clientWidth
      layout()
      draw()
    })
    resize.observe(root)

    // The theme can change under us: re-read the colours and redraw the sprites.
    const repaint = () => {
      palette = readPalette()
      buildSprites()
      draw()
    }
    const site = root.closest("[data-site]")
    const themeObserver = new MutationObserver(repaint)
    if (site) themeObserver.observe(site, { attributes: true, attributeFilter: ["data-theme"] })
    const scheme = window.matchMedia("(prefers-color-scheme: dark)")
    scheme.addEventListener("change", repaint)

    layout()
    draw()

    onCleanup(() => {
      cancelAnimationFrame(frame)
      visibility.disconnect()
      resize.disconnect()
      themeObserver.disconnect()
      scheme.removeEventListener("change", repaint)
    })
  })

  return (
    <Plate id="field" tone="paper" lead={fontContent.field.lead} aside="Canvas · ripples decay in 0.7s">
      <div data-slot="field" ref={root}>
        <canvas
          ref={canvas}
          role="img"
          aria-label="A grid of the six letters o, p, e, n, c and d with opencode spelled across the middle. Moving the pointer turns the letters around it over; clicking sends out a pulse."
        />
      </div>
    </Plate>
  )
}
