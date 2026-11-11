import { loadPixelLogo, pixelLogo } from "./pixel-logo"
import { bootDuration, bootFrame } from "./boot"
import { games } from "./games"
import { drawPixelText, pixelWidth } from "./pixel-font"

/**
 * The CRT's content drawn into any 2D canvas at any size, for renderers that cannot use the DOM
 * screen (screen.tsx), such as a three.js CanvasTexture. It draws the same states from the same
 * font, boot log and covers. It is stateless: call it every frame with the time spent in the state.
 * The DOM screen stays the accessible one; a canvas version must still offer real buttons for the
 * menu (see screen.tsx) and the game frame (game-frame.tsx).
 */

export type CanvasScreenState = "404" | "glitch" | "boot" | "start" | "select"

export type CanvasScreenOptions = {
  state: CanvasScreenState
  /** Milliseconds since the state began (drives the glitch, the boot log and the blinking). */
  time: number
  /** The highlighted game in the menu (index into `games`). */
  active?: number
  /** Game covers from `loadCovers()`, in `games` order. Missing ones draw as empty frames. */
  covers?: (CanvasImageSource | undefined)[]
  /** Reduced motion: no glitch, blinking or typing; the boot shows complete. */
  reduced?: boolean
}

export const phosphor = "#5aa2ff"
// The screen's base type size as a share of its height (arcade.css --type: 3.2cqh).
const base = 0.032
export const phosphorHot = "#d6e8ff"
const glowColor = "rgba(10, 102, 255, 0.85)"
/** Length of the glitch that turns the 404 off, in ms. */
export const glitchDuration = 900

/** Load the game covers for the menu. */
export function loadCovers() {
  return Promise.all(
    games.map(
      (game) =>
        new Promise<HTMLImageElement | undefined>((resolve) => {
          const image = new Image()
          image.decoding = "async"
          image.onload = () => resolve(image)
          image.onerror = () => resolve(undefined)
          image.src = game.cover
        }),
    ),
  )
}

/** Draw one frame of the screen into `ctx`, filling `width` × `height` px. */
export function drawScreen(ctx: CanvasRenderingContext2D, width: number, height: number, options: CanvasScreenOptions) {
  ctx.save()
  glass(ctx, width, height)
  const blink = options.reduced || Math.floor(options.time / 550) % 2 === 0
  if (options.state === "404") draw404(ctx, width, height)
  if (options.state === "glitch") drawGlitch(ctx, width, height, options.reduced ? glitchDuration : options.time)
  if (options.state === "boot") drawBoot(ctx, width, height, options.reduced ? bootDuration : options.time, blink)
  if (options.state === "start") {
    // The same title as the DOM screen (screen.tsx): the pixelated wordmark, "ARCADE", then a small
    // "PRESS START" near the bottom.
    drawLogo(ctx, width, height * 0.36, width * 0.56)
    centred(ctx, "ARCADE", width, height * 0.6, height * base, phosphor)
    if (blink) centred(ctx, "PRESS START", width, height * 0.86, height * base, phosphorHot)
  }
  if (options.state === "select") drawSelect(ctx, width, height, options, blink)
  scanlines(ctx, width, height)
  ctx.restore()
}

function glass(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const fill = ctx.createRadialGradient(
    width / 2,
    height * 0.45,
    0,
    width / 2,
    height * 0.45,
    Math.max(width, height) * 0.75,
  )
  fill.addColorStop(0, "rgb(18, 40, 82)")
  fill.addColorStop(1, "rgb(3, 8, 18)")
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, width, height)
}

function scanlines(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const step = Math.max(2, Math.round(height / 270))
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)"
  for (let y = 0; y < height; y += step) ctx.fillRect(0, y, width, Math.max(1, step / 3))
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.7,
  )
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)")
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)")
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

/** Pixel text centred on `centreY`, `size` px tall (7 cells), with the phosphor glow. */
function centred(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  centreY: number,
  size: number,
  color: string,
) {
  const cell = Math.max(1, size / 7)
  const textWidth = pixelWidth(text) * cell
  // Shrink to fit if the line is wider than the glass.
  const fitCell = textWidth > width * 0.9 ? (width * 0.9) / pixelWidth(text) : cell
  ctx.fillStyle = color
  ctx.shadowColor = glowColor
  ctx.shadowBlur = fitCell * 2.5
  drawPixelText(ctx, text, (width - pixelWidth(text) * fitCell) / 2, centreY - (7 * fitCell) / 2, fitCell)
  ctx.shadowBlur = 0
}

/** The pixelated Anomaly wordmark (pixel-logo.tsx), `size` px wide, centred on `centreY`. */
function drawLogo(ctx: CanvasRenderingContext2D, width: number, centreY: number, size: number) {
  if (!pixelLogo) return void loadPixelLogo()
  const cell = size / pixelLogo.width
  const left = (width - size) / 2
  const top = centreY - (pixelLogo.height * cell) / 2
  ctx.fillStyle = phosphorHot
  ctx.shadowColor = glowColor
  ctx.shadowBlur = cell * 2.5
  for (const [x, y] of pixelLogo.cells) ctx.fillRect(left + x * cell, top + y * cell, Math.ceil(cell), Math.ceil(cell))
  ctx.shadowBlur = 0
}

// The attract screen: "404" with "INSERT COIN" below it.
function draw404(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // The DOM screen's attract layout (arcade.css boot-404): 404 at the large step, INSERT COIN at
  // the base size below it.
  centred(ctx, "404", width, height * 0.464, height * 0.26, phosphorHot)
  centred(ctx, "INSERT COIN", width, height * 0.71, height * base, phosphor)
}

// The 404 tears, rolls and collapses to a line, then the tube goes dark.
function drawGlitch(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
  const t = Math.min(1, time / glitchDuration)
  if (t >= 1) return
  const frame = document.createElement("canvas")
  frame.width = Math.ceil(width)
  frame.height = Math.ceil(height)
  const off = frame.getContext("2d")
  if (!off) return
  draw404(off, width, height)
  const flicker = [1.7, 0.5, 1.4, 0.3, 1.9, 0.8, 1.5, 0.25, 1.2, 2][Math.floor(t * 10)] ?? 1
  const squash = t < 0.72 ? 1 : Math.max(0.01, 1 - (t - 0.72) / 0.26)
  ctx.save()
  ctx.globalAlpha = Math.min(1, flicker) * (t > 0.9 ? (1 - t) * 10 : 1)
  ctx.filter = `brightness(${flicker})`
  // Horizontal tears: bands shifted sideways.
  const bands = 6
  for (let i = 0; i < bands; i++) {
    const y = (i / bands) * height
    const h = height / bands
    const shift = Math.sin((i + 1) * 12.9 + t * 40) * width * 0.04 * (t < 0.5 ? 1 : 0.4)
    ctx.drawImage(frame, 0, y, width, h, shift, height / 2 + (y - height / 2) * squash, width, h * squash)
  }
  ctx.restore()
  // The rolling bright band.
  const roll = height * (1.2 - t * 2.4)
  const band = ctx.createLinearGradient(0, roll - height * 0.08, 0, roll + height * 0.08)
  band.addColorStop(0, "rgba(170, 210, 255, 0)")
  band.addColorStop(0.5, "rgba(170, 210, 255, 0.3)")
  band.addColorStop(1, "rgba(170, 210, 255, 0)")
  ctx.fillStyle = band
  ctx.fillRect(0, roll - height * 0.08, width, height * 0.16)
}

function drawBoot(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, blink: boolean) {
  const frame = bootFrame(time)
  const size = height * 0.034
  const lead = size * 1.45
  const left = width * 0.06
  let y = height * 0.06 + size
  ctx.font = `${size}px "OpenTUI Mono", "OpenTUI Mono Menlo", ui-monospace, monospace`
  ctx.textBaseline = "alphabetic"
  ctx.shadowColor = glowColor
  ctx.shadowBlur = size * 0.6
  for (const line of frame.lines) {
    ctx.fillStyle = phosphor
    ctx.fillText(line.text, left, y)
    let x = left + ctx.measureText(line.text).width
    if (line.status) {
      ctx.fillStyle = phosphorHot
      ctx.fillText(`  ${line.status}`, x, y)
      x += ctx.measureText(`  ${line.status}`).width
    }
    if (line.caret && blink) ctx.fillText("_", x, y)
    y += lead
  }
  if (frame.progress !== undefined) {
    ctx.fillStyle = phosphor
    ctx.fillText("BOOTING [", left, y)
    const barX = left + ctx.measureText("BOOTING [").width
    const barWidth = width * 0.4
    ctx.fillRect(barX, y - size * 0.75, barWidth * frame.progress, size * 0.8)
    ctx.fillText(`] ${Math.round(frame.progress * 100)}%`, barX + barWidth, y)
    y += lead
  }
  if (frame.ready) ctx.fillText("READY.", left, y)
  ctx.shadowBlur = 0
}

function drawSelect(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: CanvasScreenOptions,
  blink: boolean,
) {
  centred(ctx, "SELECT GAME", width, height * 0.12, height * base, phosphorHot)
  // Box art (4:5), as tall as fits between the heading and the hint, centred like the DOM menu.
  const gap = width * 0.05
  const top = height * 0.22
  const imageHeight = height * 0.52
  const tileWidth = imageHeight * (4 / 5)
  const padding = (width - tileWidth * 3 - gap * 2) / 2
  games.forEach((game, index) => {
    const x = padding + index * (tileWidth + gap)
    const cover = options.covers?.[index]
    if (cover) ctx.drawImage(cover, x, top, tileWidth, imageHeight)
    ctx.strokeStyle = "rgba(90, 162, 255, 0.55)"
    ctx.lineWidth = Math.max(1, height * 0.003)
    ctx.strokeRect(x, top, tileWidth, imageHeight)
    const label = game.name.toUpperCase()
    const cell = (height * base) / 7
    ctx.fillStyle = index === options.active ? phosphorHot : phosphor
    drawPixelText(ctx, label, x + (tileWidth - pixelWidth(label) * cell) / 2, top + imageHeight + height * 0.03, cell)
    if (index === options.active && blink)
      brackets(
        ctx,
        x - height * 0.016,
        top - height * 0.016,
        tileWidth + height * 0.032,
        imageHeight + height * 0.09,
        height,
      )
  })
  centred(ctx, "< > CHOOSE  ENTER PLAY", width, height * 0.88, height * base, phosphor)
}

function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, height: number) {
  const arm = height * 0.022
  const t = height * 0.005
  ctx.fillStyle = phosphorHot
  for (const [cx, cy, sx, sy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ] as const) {
    ctx.fillRect(sx > 0 ? cx : cx - arm, sy > 0 ? cy : cy - t, arm, t)
    ctx.fillRect(sx > 0 ? cx : cx - t, sy > 0 ? cy : cy - arm, t, arm)
  }
}
