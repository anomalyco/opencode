// The share card: one section of the home page as a branded image, drawn on a canvas so the preview, the PNG and
// every frame of the video come from the same code. drawShareCard(ctx, card, options, time) draws the card as it
// looks `time` seconds into its animation; time past shareDuration() is the still, which is also the PNG.

export type ShareSeries = { key: string; label: string; color: string; value: string }

export type ShareChart =
  | {
      kind: "stacked"
      // Market share: each column fills the chart height.
      normalized: boolean
      series: ShareSeries[]
      // values[i] is series[i]'s value in the column; series[0] stacks at the bottom.
      columns: { label: string; values: number[] }[]
    }
  | {
      kind: "ranked"
      rows: { rank: string; label: string; value: string; fill: number }[]
    }

export type ShareCard = {
  id: string
  title: string
  range: string
  headline: string
  stat: { value: string; label: string }
  updatedAt: string | null
  url: string
  chart: ShareChart
}

export type ShareOptions = {
  layout: "headline" | "number" | "chart"
  theme: "dark" | "light"
  size: "4:5" | "1:1" | "9:16" | "16:9"
  background: "dots" | "plain" | "band"
  motion: "highlight" | "build"
  logo: "lockup" | "full"
}

export const defaultShareOptions: ShareOptions = {
  layout: "headline",
  theme: "dark",
  size: "4:5",
  background: "dots",
  motion: "highlight",
  logo: "lockup",
}

export const shareSizes = {
  "4:5": [1080, 1350],
  "1:1": [1080, 1080],
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
} as const

// The Data site's palettes (routes/index.css); dark matches the Open Graph cards (og/card.ts).
const palettes = {
  dark: {
    background: "#161616",
    text: "#ffffff",
    muted: "#c4c4c4",
    faint: "#8f8f8f",
    line: "#ffffff1f",
    dot: "#292929",
    idle: "#2e2e2e",
    track: "#242424",
    accent: "#8190ff",
    mark: "#4b4b4b",
  },
  light: {
    background: "#fbfbfb",
    text: "#161616",
    muted: "#3a3a3a",
    faint: "#6b6b6b",
    line: "#0000001a",
    dot: "#eeeeee",
    idle: "#e2e2e2",
    track: "#eeeeee",
    accent: "#3b5cf6",
    mark: "#c8c8c8",
  },
}

type Palette = (typeof palettes)["dark"]

const font = '"OpenTUI Mono", ui-monospace, monospace'
const pad = 80
const build = 1.2
const step = 1.1
const hold = 1.6

/** Waits for the card's font, so the first frame isn't drawn in the fallback. */
export async function loadShareFonts() {
  await Promise.all([document.fonts.load(`400 40px ${font}`), document.fonts.load(`700 40px ${font}`)])
}

/** The video's length in seconds: the chart builds, each leading series takes a turn, then the still holds. */
export function shareDuration(card: ShareCard, options: ShareOptions) {
  return build + highlights(card, options).length * step + hold
}

export function drawShareCard(ctx: CanvasRenderingContext2D, card: ShareCard, options: ShareOptions, time: number) {
  const [width, height] = shareSizes[options.size]
  const colors = palettes[options.theme]
  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, width, height)
  drawBackground(ctx, options.background, colors, width, height)
  drawLogo(ctx, options.logo, colors, pad, pad)

  const focus = focusAt(card, options, time)
  const top = drawIntro(ctx, card, options, colors, width, pad + 136)
  const footer = height - pad - 28
  const legend = card.chart.kind === "stacked" ? legendLayout(card.chart.series, width) : undefined
  const chartBottom = footer - 56 - (legend ? legend.height + 40 : 0)
  const progress = Math.min(1, time / build)

  if (card.chart.kind === "stacked") {
    drawStacked(
      ctx,
      card.chart,
      colors,
      { x: pad, y: top, width: width - pad * 2, height: chartBottom - top },
      progress,
      focus,
    )
    if (legend) drawLegend(ctx, card.chart.series, legend, colors, pad, chartBottom + 40, focus)
  }
  if (card.chart.kind === "ranked")
    drawRanked(
      ctx,
      card.chart,
      colors,
      { x: pad, y: top, width: width - pad * 2, height: chartBottom - top },
      progress,
      focus,
    )

  drawFooter(ctx, card, colors, width, footer)
  ctx.restore()
}

// The highlight's state at `time`: which series (or row) leads and how far the others have dimmed.
function focusAt(card: ShareCard, options: ShareOptions, time: number) {
  const order = highlights(card, options)
  const local = time - build
  if (local < 0 || local >= order.length * step) return { index: -1, amount: 0 }
  const turn = Math.floor(local / step)
  const within = local - turn * step
  // Fade in over the first quarter of a turn; between turns the dimming stays, so only the focus moves.
  const first = turn === 0 ? Math.min(1, within / 0.25) : 1
  const last = turn === order.length - 1 ? Math.min(1, (step - within) / 0.25) : 1
  return { index: order[turn] ?? -1, amount: ease(Math.min(first, last)) }
}

function highlights(card: ShareCard, options: ShareOptions) {
  if (options.motion === "build") return []
  const count =
    card.chart.kind === "stacked"
      ? card.chart.series.filter((item) => item.key !== "other").length
      : card.chart.rows.length
  return Array.from({ length: Math.min(card.chart.kind === "stacked" ? 5 : 3, count) }, (_, index) => index)
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  kind: ShareOptions["background"],
  colors: Palette,
  width: number,
  height: number,
) {
  if (kind === "plain") return
  // The banner's dot grid: 8px squares on a 24px pitch, fading out down the card (og/card.ts).
  const fade = kind === "band" ? 0.28 : 0.6
  for (let y = 1; y < height * fade; y += 24) {
    ctx.globalAlpha = Math.max(0, 1 - y / (height * fade))
    ctx.fillStyle = colors.dot
    for (let x = -4; x < width; x += 24) ctx.fillRect(x, y, 8, 8)
  }
  ctx.globalAlpha = 1
  if (kind !== "band") return
  ctx.fillStyle = colors.dot
  for (let x = -4; x < width; x += 24) ctx.fillRect(x, height - 25, 8, 8)
}

// The header lockup: the OpenCode mark, then DATA (or OPENCODE DATA), set like the site's header.
function drawLogo(ctx: CanvasRenderingContext2D, kind: ShareOptions["logo"], colors: Palette, x: number, y: number) {
  const size = 48
  const scale = size / 300
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = colors.mark
  ctx.fill(new Path2D("M180 240H60V120H180V240Z"))
  ctx.fillStyle = colors.text
  ctx.fill(new Path2D("M180 60H60V240H180V60ZM240 300H0V0H240V300Z"), "evenodd")
  ctx.restore()
  ctx.fillStyle = colors.text
  ctx.textBaseline = "middle"
  ctx.font = `700 34px ${font}`
  spaced(ctx, kind === "full" ? "OPENCODE DATA" : "DATA", x + 40 + 24, y + size / 2 + 1, 34 * 0.08)
}

// The eyebrow, then the headline, the big number or the title; returns where the chart starts.
function drawIntro(
  ctx: CanvasRenderingContext2D,
  card: ShareCard,
  options: ShareOptions,
  colors: Palette,
  width: number,
  y: number,
) {
  const max = width - pad * 2
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = colors.faint
  ctx.font = `400 26px ${font}`
  const eyebrow = options.layout === "chart" ? card.range.toUpperCase() : `${card.title} · ${card.range}`.toUpperCase()
  spaced(ctx, eyebrow, pad, y + 26, 26 * 0.06)

  if (options.layout === "number") {
    ctx.fillStyle = colors.text
    const size = fit(ctx, card.stat.value, max, 200, 700)
    ctx.font = `700 ${size}px ${font}`
    ctx.fillText(card.stat.value, pad - size * 0.04, y + 64 + size * 0.8)
    ctx.font = `400 34px ${font}`
    ctx.fillStyle = colors.muted
    const lines = wrap(ctx, card.stat.label, max).slice(0, 2)
    lines.forEach((line, index) => ctx.fillText(line, pad, y + 64 + size * 0.8 + 64 + index * 44))
    return y + 64 + size * 0.8 + 64 + lines.length * 44 + 24
  }

  if (options.layout === "chart") {
    ctx.fillStyle = colors.text
    const size = fit(ctx, card.title, max, 88, 400)
    ctx.font = `400 ${size}px ${font}`
    ctx.fillText(card.title, pad - 2, y + 64 + size * 0.8)
    return y + 64 + size + 32
  }

  ctx.fillStyle = colors.text
  const size =
    [64, 56, 50, 44].find((value) => {
      ctx.font = `400 ${value}px ${font}`
      return wrap(ctx, card.headline, max).length <= 3
    }) ?? 44
  ctx.font = `400 ${size}px ${font}`
  const lines = wrap(ctx, card.headline, max).slice(0, 4)
  const leading = size * 1.18
  lines.forEach((line, index) => ctx.fillText(line, pad - 2, y + 56 + size * 0.8 + index * leading))
  return y + 56 + lines.length * leading + 32
}

type Box = { x: number; y: number; width: number; height: number }
type Focus = { index: number; amount: number }

function drawStacked(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "stacked" }>,
  colors: Palette,
  box: Box,
  progress: number,
  focus: Focus,
) {
  const axis = 44
  // Room above the bars for the focused series' label.
  const headroom = 72
  const plot = { ...box, y: box.y + headroom, height: box.height - axis - headroom }
  const count = chart.columns.length
  const totals = chart.columns.map((column) => column.values.reduce((sum, value) => sum + value, 0))
  const max = Math.max(1, ...totals)
  const slot = plot.width / Math.max(1, count)
  const gap = Math.min(10, Math.max(2, slot * 0.22))
  const base = plot.y + plot.height

  chart.columns.forEach((column, index) => {
    // Columns rise left to right, each over half the build.
    const delay = (index / Math.max(1, count - 1)) * 0.5
    const grow = ease(Math.max(0, Math.min(1, (progress - delay) / 0.5)))
    const total = totals[index] ?? 0
    const height = (chart.normalized ? plot.height : (total / max) * plot.height) * grow
    const x = plot.x + index * slot + gap / 2
    const width = slot - gap
    // The series in focus moves to the baseline, so its trend reads even when it's a thin slice.
    const order = column.values.map((_, series) => series)
    const stack =
      focus.amount > 0 && focus.index >= 0 ? [focus.index, ...order.filter((item) => item !== focus.index)] : order
    stack.reduce((y, series) => {
      const value = column.values[series] ?? 0
      if (value <= 0 || total <= 0) return y
      const size = (value / total) * height
      ctx.fillStyle = mix(
        chart.series[series]?.color ?? colors.idle,
        colors.idle,
        series === focus.index ? 0 : focus.amount,
      )
      ctx.fillRect(x, y - size, width, Math.max(0, size - (size > 3 ? 1 : 0)))
      return y - size
    }, base)
  })

  const focused = chart.series[focus.index]
  if (focused && focus.amount > 0) {
    ctx.globalAlpha = focus.amount
    ctx.font = `700 30px ${font}`
    ctx.textBaseline = "middle"
    const label = `${focused.label}  ${focused.value}`
    const top = box.y + 4
    ctx.fillStyle = focused.color
    ctx.fillRect(plot.x, top + 18, 20, 20)
    ctx.fillStyle = colors.text
    ctx.fillText(label, plot.x + 36, top + 29)
    ctx.globalAlpha = 1
  }

  ctx.fillStyle = colors.line
  ctx.fillRect(plot.x, base + 1, plot.width, 1)
  ctx.fillStyle = colors.faint
  ctx.font = `400 22px ${font}`
  ctx.textBaseline = "alphabetic"
  const ticks = [...new Set([0, Math.round((count - 1) / 3), Math.round(((count - 1) * 2) / 3), count - 1])]
  ticks.forEach((index, position) => {
    const label = chart.columns[index]?.label ?? ""
    const center = plot.x + index * slot + slot / 2
    const measured = ctx.measureText(label).width
    const x =
      position === 0 ? plot.x : position === ticks.length - 1 ? plot.x + plot.width - measured : center - measured / 2
    ctx.fillText(label, x, base + axis - 6)
  })
}

function legendLayout(series: ShareSeries[], width: number) {
  const columns = width > 1400 ? 3 : 2
  const rows = Math.ceil(series.length / columns)
  return { columns, rows, row: 48, column: (width - pad * 2) / columns, height: rows * 48 }
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  series: ShareSeries[],
  layout: ReturnType<typeof legendLayout>,
  colors: Palette,
  x: number,
  y: number,
  focus: Focus,
) {
  ctx.textBaseline = "middle"
  series.forEach((item, index) => {
    const column = Math.floor(index / layout.rows)
    const row = index % layout.rows
    const left = x + column * layout.column
    const middle = y + row * layout.row + layout.row / 2
    const dim = index === focus.index ? 0 : focus.amount
    ctx.fillStyle = mix(item.color, colors.idle, dim)
    ctx.fillRect(left, middle - 9, 18, 18)
    ctx.font = `400 24px ${font}`
    ctx.fillStyle = mix(colors.muted, colors.faint, dim)
    const measured = ctx.measureText(item.value).width
    const right = left + layout.column - (column === layout.columns - 1 ? 0 : 48)
    ctx.fillText(item.value, right - measured, middle)
    ctx.font = `${index === focus.index && focus.amount > 0.5 ? 700 : 400} 24px ${font}`
    ctx.fillStyle = mix(colors.text, colors.faint, dim)
    ctx.fillText(truncate(ctx, item.label, right - measured - 24 - (left + 38)), left + 38, middle)
  })
}

function drawRanked(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "ranked" }>,
  colors: Palette,
  box: Box,
  progress: number,
  focus: Focus,
) {
  const rows = chart.rows.slice(0, Math.max(1, Math.floor(box.height / 72)))
  const row = Math.min(112, box.height / Math.max(1, rows.length))
  const size = row >= 96 ? 30 : 26
  rows.forEach((item, index) => {
    const y = box.y + index * row
    const delay = (index / Math.max(1, rows.length - 1)) * 0.45
    const grow = ease(Math.max(0, Math.min(1, (progress - delay) / 0.55)))
    const dim = index === focus.index ? 0 : focus.amount
    ctx.textBaseline = "alphabetic"
    ctx.font = `400 ${size}px ${font}`
    ctx.fillStyle = colors.faint
    ctx.fillText(item.rank, box.x, y + size)
    const valueWidth = ctx.measureText(item.value).width
    ctx.fillStyle = mix(colors.muted, colors.faint, dim)
    ctx.fillText(item.value, box.x + box.width - valueWidth, y + size)
    ctx.font = `${index === focus.index && focus.amount > 0.5 ? 700 : 400} ${size}px ${font}`
    ctx.fillStyle = mix(colors.text, colors.faint, dim)
    ctx.fillText(truncate(ctx, item.label, box.width - 72 - valueWidth - 32), box.x + 72, y + size)
    const bar = y + size + 18
    ctx.fillStyle = colors.track
    ctx.fillRect(box.x + 72, bar, box.width - 72, 10)
    ctx.fillStyle = mix(colors.accent, colors.idle, dim)
    ctx.fillRect(box.x + 72, bar, (box.width - 72) * Math.max(0.01, Math.min(1, item.fill)) * grow, 10)
  })
}

function drawFooter(ctx: CanvasRenderingContext2D, card: ShareCard, colors: Palette, width: number, y: number) {
  ctx.fillStyle = colors.line
  ctx.fillRect(pad, y - 40, width - pad * 2, 1)
  ctx.textBaseline = "middle"
  ctx.font = `700 26px ${font}`
  ctx.fillStyle = colors.text
  ctx.fillText(card.url, pad, y)
  if (!card.updatedAt) return
  ctx.font = `400 24px ${font}`
  ctx.fillStyle = colors.faint
  const label = `Updated ${formatUpdated(card.updatedAt)}`
  ctx.fillText(label, width - pad - ctx.measureText(label).width, y)
}

function formatUpdated(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)} UTC`
}

// Draws text with tracking one character at a time, since canvas letterSpacing isn't in every browser.
function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  ;[...text].reduce((left, char) => {
    ctx.fillText(char, left, y)
    return left + ctx.measureText(char).width + tracking
  }, x)
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  return text.split(/\s+/).reduce<string[]>((lines, word) => {
    const last = lines.at(-1)
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= max)
      return [...lines.slice(0, -1), `${last} ${word}`]
    return [...lines, word]
  }, [])
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  const chars = [...text]
  const length = chars.findLastIndex((_, index) => ctx.measureText(`${chars.slice(0, index).join("")}…`).width <= max)
  return `${chars.slice(0, Math.max(1, length)).join("")}…`
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight: number) {
  ctx.font = `${weight} ${size}px ${font}`
  const width = ctx.measureText(text).width
  return width <= max ? size : Math.floor((size * max) / width)
}

function ease(value: number) {
  return 1 - (1 - value) ** 3
}

// Blends two #rrggbb colours; `amount` 1 is all `to`.
function mix(from: string, to: string, amount: number) {
  if (amount <= 0) return from
  if (amount >= 1) return to
  const a = rgb(from)
  const b = rgb(to)
  return `rgb(${a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * amount)).join(" ")})`
}

function rgb(color: string) {
  const hex = color.replace("#", "").slice(0, 6)
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16))
}
