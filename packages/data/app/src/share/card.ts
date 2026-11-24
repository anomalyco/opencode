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
    dot: "#2f2f2f",
    meter: "#5e5e5e",
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
    dot: "#e4e4e4",
    meter: "#b4b4b4",
    idle: "#e2e2e2",
    track: "#eeeeee",
    accent: "#3b5cf6",
    mark: "#c8c8c8",
  },
}

type Palette = (typeof palettes)["dark"]

const font = '"OpenTUI Mono", ui-monospace, monospace'
const pad = 80
const hold = 1.6
// The space under a stacked chart for its date labels.
const axisHeight = 44

// When the chart builds, when the highlights start, how long each takes and how many times they go round. Without
// music it runs at its own pace; with a soundtrack it follows the track (barTiming) and `beat` drives the dot meter.
export type ShareTiming = { build: number; start: number; step: number; rounds: number; beat?: number; length?: number }
const freeTiming: ShareTiming = { build: 1.2, start: 1.2, step: 1.1, rounds: 1 }

/**
 * The chart builds over the first bar; from the verse each highlight takes half a bar and the leaders go round twice;
 * the dots pulse on every beat; the video ends with the track.
 */
export function barTiming(bar: number, verse: number, length: number): ShareTiming {
  return { build: bar, start: verse, step: bar / 2, rounds: 2, beat: bar / 4, length }
}

/** Waits for the card's font, so the first frame isn't drawn in the fallback. */
export async function loadShareFonts() {
  await Promise.all([document.fonts.load(`400 40px ${font}`), document.fonts.load(`700 40px ${font}`)])
}

/** The video's length in seconds: the chart builds, each leading series takes a turn, then the still holds. */
export function shareDuration(card: ShareCard, options: ShareOptions, timing = freeTiming) {
  return timing.length ?? timing.start + highlights(card, options).length * timing.rounds * timing.step + hold
}

export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  card: ShareCard,
  options: ShareOptions,
  time: number,
  timing = freeTiming,
) {
  const [width, height] = shareSizes[options.size]
  const colors = palettes[options.theme]
  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, width, height)
  // The footer's baseline sits as far from the bottom as its text from the side; the rule is 56px above its type.
  const footer = height - pad
  const rule = footer - 26 - 56
  const legend = card.chart.kind === "stacked" ? legendLayout(card.chart.series, width) : undefined
  const chartBottom = rule - 64 - (legend ? legend.height + 40 : 0)
  // The dots are gone by the x axis: a stacked chart's baseline sits its axis labels above the chart's bottom.
  const baseline = card.chart.kind === "stacked" ? chartBottom - axisHeight : chartBottom
  drawBackground(
    ctx,
    options.background,
    colors,
    width,
    height,
    dotGrid(card.chart, width),
    baseline * 0.4,
    baseline,
    timing.beat && time < (timing.length ?? Infinity) ? meter(time, timing.beat) : undefined,
  )
  drawLogo(ctx, options.logo, colors, pad, pad)

  const focus = focusAt(card, options, time, timing)
  const top = drawIntro(ctx, card, options, colors, width, pad + 136, time)
  const progress = Math.min(1, time / timing.build)

  if (card.chart.kind === "stacked") {
    drawStacked(
      ctx,
      card.chart,
      colors,
      { x: pad, y: top, width: width - pad * 2, height: chartBottom - top },
      progress,
      focus,
    )
    if (legend) drawLegend(ctx, card.chart.series, legend, colors, pad, chartBottom + 40, focus, time)
  }
  if (card.chart.kind === "ranked")
    drawRanked(
      ctx,
      card.chart,
      colors,
      { x: pad, y: top, width: width - pad * 2, height: chartBottom - top },
      progress,
      focus,
      time,
    )

  drawFooter(ctx, card, colors, width, footer, rule)
  ctx.restore()
}

// The highlight's state at `time`: which series (or row) leads and how far the others have dimmed.
function focusAt(card: ShareCard, options: ShareOptions, time: number, timing: ShareTiming) {
  const once = highlights(card, options)
  const order = Array.from({ length: timing.rounds }, () => once).flat()
  const step = timing.step
  const local = time - timing.start
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
  grid: { center: number; pitch: number },
  fadeStart: number,
  fadeEnd: number,
  level?: (column: number) => number,
) {
  if (kind === "plain") return
  // The banner's dot grid (og/card.ts), on the chart's own pitch: square dots on square cells, at full strength from the
  // top, then fading out from fadeStart to nothing at fadeEnd (the x axis). The first row sits as far from the top as
  // the first column from the side.
  const dot = Math.min(8, Math.max(4, Math.round(grid.pitch * 0.36)))
  const first = grid.center - Math.floor(grid.center / grid.pitch) * grid.pitch
  const inset = Math.max(0, first - dot / 2)
  const end = kind === "band" ? height * 0.28 : fadeEnd
  const columns = Array.from(
    { length: Math.floor((width - inset - dot) / grid.pitch) + 1 },
    (_, index) => inset + index * grid.pitch,
  )
  // With music, each column is also a level meter hanging from the top: its lit dots reach further down on the beat.
  const reach = Math.floor((end - inset) / grid.pitch / 2)
  const lit = columns.map((_, index) => (level ? Math.round(level(index) * reach) : 0))
  for (let y = inset, row = 0; y < end; y += grid.pitch, row++) {
    ctx.globalAlpha =
      kind === "band" ? Math.max(0, 1 - y / end) : Math.min(1, Math.max(0, (end - y) / (end - fadeStart)))
    columns.forEach((x, index) => {
      ctx.fillStyle = row < (lit[index] ?? 0) ? colors.meter : colors.dot
      ctx.fillRect(x, y, dot, dot)
    })
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = colors.dot
  if (kind !== "band") return
  columns.forEach((x) => ctx.fillRect(x, height - inset - dot, dot, dot))
}

// The meter's level for each dot column at `time`: it jumps on every beat and falls away before the next, higher on the
// first beat of a bar. A rolling wave across the columns, roughened per beat, so neighbours move together like an
// equaliser. Deterministic, so the preview and the export match frame for frame.
function meter(time: number, beat: number) {
  const count = Math.floor(time / beat)
  const fall = (1 - (time / beat - count)) ** 2.2
  const accent = count % 4 === 0 ? 1 : 0.72
  return (column: number) => {
    const wave = 0.5 + 0.5 * Math.sin(column * 0.42 + count * 1.9)
    const grain = (Math.sin(column * 12.9898 + count * 78.233) * 43758.5453) % 1
    return Math.max(0, Math.min(1, (0.35 + 0.65 * wave) * (0.75 + 0.25 * Math.abs(grain)) * accent * fall))
  }
}

// A column of dots over every bar of a stacked chart (every second or third when the bars are narrow), lined up
// with the last bar; other charts take the banner's 24px pitch, centred.
function dotGrid(chart: ShareChart, width: number) {
  if (chart.kind !== "stacked" || chart.columns.length === 0) return { center: width / 2, pitch: 24 }
  const slot = (width - pad * 2) / chart.columns.length
  return { center: pad + (chart.columns.length - 0.5) * slot, pitch: slot * Math.ceil(14 / slot) }
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
  time: number,
) {
  const max = width - pad * 2
  ctx.textBaseline = "alphabetic"
  const eyebrow = options.layout === "chart" ? card.range.toUpperCase() : `${card.title} · ${card.range}`.toUpperCase()
  rise(ctx, time, 0.05, y + 32, 32, () => {
    ctx.fillStyle = colors.faint
    ctx.font = `400 32px ${font}`
    spaced(ctx, eyebrow, pad, y + 32, 32 * 0.06)
  })

  if (options.layout === "number") {
    const size = fit(ctx, card.stat.value, max, 200, 700)
    rise(ctx, time, 0.14, y + 64 + size * 0.8, size * 0.8, () => {
      ctx.fillStyle = colors.text
      ctx.font = `700 ${size}px ${font}`
      ctx.fillText(card.stat.value, pad - size * 0.04, y + 64 + size * 0.8)
    })
    ctx.font = `400 34px ${font}`
    const lines = balance(ctx, card.stat.label, max).slice(0, 2)
    lines.forEach((line, index) =>
      rise(ctx, time, 0.3 + index * 0.07, y + 64 + size * 0.8 + 64 + index * 44, 34, () => {
        ctx.fillStyle = colors.muted
        ctx.font = `400 34px ${font}`
        ctx.fillText(line, pad, y + 64 + size * 0.8 + 64 + index * 44)
      }),
    )
    return y + 64 + size * 0.8 + 64 + lines.length * 44 + 24
  }

  if (options.layout === "chart") {
    const size = fit(ctx, card.title, max, 88, 400)
    rise(ctx, time, 0.14, y + 64 + size * 0.8, size, () => {
      ctx.fillStyle = colors.text
      ctx.font = `400 ${size}px ${font}`
      ctx.fillText(card.title, pad - 2, y + 64 + size * 0.8)
    })
    return y + 64 + size + 32
  }

  const size =
    [64, 56, 50, 44].find((value) => {
      ctx.font = `400 ${value}px ${font}`
      return wrap(ctx, card.headline, max).length <= 3
    }) ?? 44
  ctx.font = `400 ${size}px ${font}`
  const lines = balance(ctx, card.headline, max).slice(0, 4)
  const leading = size * 1.18
  lines.forEach((line, index) =>
    rise(ctx, time, 0.14 + index * 0.08, y + 56 + size * 0.8 + index * leading, size, () => {
      ctx.fillStyle = colors.text
      ctx.font = `400 ${size}px ${font}`
      ctx.fillText(line, pad - 2, y + 56 + size * 0.8 + index * leading)
    }),
  )
  return y + 56 + lines.length * leading + 32
}

// A line of text rising into place from behind its own baseline, as in an editorial title reveal: it slides up
// inside a mask one line tall and fades in, on a long ease-out. `baseline` and `size` place the mask.
function rise(
  ctx: CanvasRenderingContext2D,
  time: number,
  delay: number,
  baseline: number,
  size: number,
  draw: () => void,
) {
  const amount = settle(time, delay, 0.75)
  if (amount <= 0) return
  if (amount >= 1) return draw()
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, baseline - size * 1.05, ctx.canvas.width, size * 1.4)
  ctx.clip()
  ctx.globalAlpha = Math.min(1, amount * 1.6)
  ctx.translate(0, (1 - amount) * size * 1.1)
  draw()
  ctx.restore()
}

// 0 before `delay`, then a quint ease-out to 1 over `length` seconds. The still (time Infinity) is always 1.
function settle(time: number, delay: number, length: number) {
  const t = Math.max(0, Math.min(1, (time - delay) / length))
  return 1 - (1 - t) ** 5
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
  // Room above the bars for the focused series' label.
  const headroom = 72
  const plot = { ...box, y: box.y + headroom, height: box.height - axisHeight - headroom }
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
    ctx.fillText(label, x, base + axisHeight - 6)
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
  time: number,
) {
  ctx.textBaseline = "middle"
  series.forEach((item, index) => {
    const column = Math.floor(index / layout.rows)
    const row = index % layout.rows
    const left = x + column * layout.column
    const middle = y + row * layout.row + layout.row / 2
    const dim = index === focus.index ? 0 : focus.amount
    // Each entry rises in after the headline, down each column in turn.
    const amount = settle(time, 0.45 + index * 0.05, 0.6)
    if (amount <= 0) return
    ctx.save()
    ctx.globalAlpha = amount
    ctx.translate(0, (1 - amount) * 14)
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
    ctx.restore()
  })
}

function drawRanked(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "ranked" }>,
  colors: Palette,
  box: Box,
  progress: number,
  focus: Focus,
  time: number,
) {
  const rows = chart.rows.slice(0, Math.max(1, Math.floor(box.height / 72)))
  const row = Math.min(112, box.height / Math.max(1, rows.length))
  const size = row >= 96 ? 30 : 26
  rows.forEach((item, index) => {
    const y = box.y + index * row
    const delay = (index / Math.max(1, rows.length - 1)) * 0.45
    const grow = ease(Math.max(0, Math.min(1, (progress - delay) / 0.55)))
    const dim = index === focus.index ? 0 : focus.amount
    // The row's words rise in as its bar starts to grow.
    const amount = settle(time, 0.3 + index * 0.06, 0.6)
    if (amount <= 0) return
    ctx.save()
    ctx.globalAlpha = amount
    ctx.translate(0, (1 - amount) * 14)
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
    ctx.restore()
  })
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  card: ShareCard,
  colors: Palette,
  width: number,
  y: number,
  rule: number,
) {
  // The rule takes the dot grid's colour.
  ctx.fillStyle = colors.dot
  ctx.fillRect(pad, rule, width - pad * 2, 1)
  ctx.textBaseline = "alphabetic"
  ctx.font = `700 34px ${font}`
  ctx.fillStyle = colors.text
  ctx.fillText(card.url, pad, y)
  if (!card.updatedAt) return
  ctx.font = `400 30px ${font}`
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

// Like CSS text-wrap: balance. The same number of lines as wrapping at `max`, at the narrowest width that keeps
// them, so no line ends up with a lone word.
function balance(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const count = wrap(ctx, text, max).length
  if (count <= 1) return wrap(ctx, text, max)
  const search = (low: number, high: number): number => {
    if (high - low <= 4) return high
    const middle = (low + high) / 2
    return wrap(ctx, text, middle).length > count ? search(middle, high) : search(low, middle)
  }
  return wrap(ctx, text, search(max / count, max))
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
