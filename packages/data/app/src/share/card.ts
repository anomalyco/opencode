// The share card: one section of the home page as a branded image, drawn on a canvas so the preview, the PNG and
// every frame of the video come from the same code. drawShareCard(ctx, card, options, time) draws the card as it
// looks `time` seconds into its animation; time past shareDuration() is the still, which is also the PNG.

import { shareLogo } from "./logos"
import { spectrumLevel, type Spectrum } from "./spectrum"

export type ShareSeries = { key: string; label: string; color: string; value: string }

export type ShareChart =
  | {
      kind: "stacked"
      // Market share: each column fills the chart height.
      normalized: boolean
      series: ShareSeries[]
      // values[i] is series[i]'s value in the column; series[0] stacks at the bottom.
      columns: { label: string; values: number[] }[]
      // The line under the chart before a series takes it, such as the latest column's total.
      total: { label: string; value: string }
    }
  | {
      kind: "ranked"
      rows: { rank: string; label: string; value: string; fill: number }[]
    }
  | {
      // The leaderboard's top three: each with its place, model, provider, tokens and change, and its provider's logo
      // (a ProviderIcon id, share/logos.ts) large and faint behind it.
      kind: "podium"
      entries: {
        place: string
        label: string
        provider: string
        value: string
        change: string
        tone: Tone
        logo: string
      }[]
    }
  | {
      // Two models side by side: their names and logos, then a row a metric, each model's value and bar; `lead` is the
      // model the metric favours (higher usage, lower cost), or -1 for a tie.
      kind: "versus"
      models: { label: string; provider: string; logo: string }[]
      rows: { label: string; values: string[]; fills: number[]; lead: number }[]
    }

export type Tone = "up" | "down" | "new" | "flat"

export type ShareCard = {
  id: string
  // The winner's name as the headline writes it, which the Leader style sets in the winner's colour.
  highlight?: string
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
  // leader: the card takes the leading series' colour, and the chart turns to tones of one ink (leaderLook).
  theme: "dark" | "light" | "leader"
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

// The Data site's palettes (routes/index.css). Dark sits on the site's own dark page colour (--stats-bg).
const palettes = {
  dark: {
    background: "#0c0c0c",
    text: "#ffffff",
    muted: "#c4c4c4",
    faint: "#8f8f8f",
    line: "#ffffff1f",
    dot: "#1e1e1e",
    meter: "#8c8c8c",
    idle: "#262626",
    track: "#1c1c1c",
    accent: "#8190ff",
    mark: "#4b4b4b",
    // The first ranked row's bar, and the winner's name in the headline; the Leader style colours them.
    lead: "#8190ff",
    highlight: "#ffffff",
    // A highlighted series lights up in this colour instead of its own (the Top style's white); empty keeps its own.
    spotlight: "",
    // The "Other" series: the same muted grey a dimmed series takes, so it sits back the whole time.
    other: "#262626",
    // The muted grey as a see-through veil, so the equaliser shows through a muted bar; over the plain card it reads
    // as `idle`.
    veil: "rgb(255 255 255 / 0.1)",
    up: "#3fb950",
    down: "#f85149",
  },
  light: {
    background: "#fbfbfb",
    text: "#161616",
    muted: "#3a3a3a",
    faint: "#6b6b6b",
    line: "#0000001a",
    dot: "#ececec",
    meter: "#b4b4b4",
    idle: "#e2e2e2",
    track: "#eeeeee",
    accent: "#3b5cf6",
    mark: "#c8c8c8",
    lead: "#3b5cf6",
    highlight: "#161616",
    spotlight: "",
    other: "#e2e2e2",
    veil: "rgb(0 0 0 / 0.1)",
    up: "#1a7f37",
    down: "#cf222e",
  },
}

type Palette = (typeof palettes)["dark"]

/** The colour the Leader style takes: the leading series' colour, or the site's accent for a ranked list. */
export function leaderColor(card: Pick<ShareCard, "chart">) {
  return card.chart.kind === "stacked" ? (card.chart.series[0]?.color ?? "#a684ff") : "#a684ff"
}

// The Leader style: the dark card, where only the winner keeps its colour. The other series turn to greys, the dot
// grid takes a faint tint of the winner's colour, the equaliser plays in it, and the headline sets the winner's name
// and the big number in it.
// A dark or light card: the "Other" series takes the palette's grey.
function themed(card: ShareCard, colors: Palette) {
  if (card.chart.kind !== "stacked") return { colors, card }
  const series = card.chart.series.map((item) => (item.key === "other" ? { ...item, color: colors.other } : item))
  return { colors, card: { ...card, chart: { ...card.chart, series } } }
}

function leaderLook(card: ShareCard): { colors: Palette; card: ShareCard } {
  const color = leaderColor(card)
  const base = palettes.dark
  const grey = (amount: number) => hex(base.background, "#ffffff", amount)
  const colors: Palette = {
    ...base,
    dot: hex(base.background, color, 0.14),
    meter: color,
    accent: grey(0.3),
    lead: color,
    highlight: color,
    spotlight: "#ffffff",
  }
  if (card.chart.kind !== "stacked") return { colors, card }
  const steps = [1, 0.36, 0.29, 0.23, 0.19, 0.16]
  const series = card.chart.series.map((item, index) => ({
    ...item,
    color: index === 0 ? item.color : item.key === "other" ? grey(0.12) : grey(steps[index] ?? 0.14),
  }))
  return { colors, card: { ...card, chart: { ...card.chart, series } } }
}

// mix() as a #rrggbb colour, for palette entries that are mixed again later.
function hex(from: string, to: string, amount: number) {
  const a = rgb(from)
  const b = rgb(to)
  return `#${a
    .map((value, index) =>
      Math.round(value + ((b[index] ?? value) - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

const font = '"OpenMono", "OpenMono Menlo", "OpenMono Consolas", "OpenMono Courier", ui-monospace, monospace'
const pad = 80
// The still holds long enough for the legend to arrive after the highlights.
const hold = 2.2
// The space under a stacked chart for its date labels.
const axisHeight = 44

// When the chart builds, when the highlights start, how long each takes and how many times they go round. Without
// music it runs at its own pace; with a soundtrack it follows the track (barTiming) and `beat` drives the dot meter.
export type ShareTiming = {
  build: number
  start: number
  step: number
  rounds: number
  beat?: number
  length?: number
  spectrum?: Spectrum
}
const freeTiming: ShareTiming = { build: 0.8, start: 1, step: 1.1, rounds: 1 }

/**
 * The chart builds over the first bar; from the verse each highlight takes half a bar and the leaders go round twice;
 * the dots pulse on every beat; the video ends with the track.
 */
export function barTiming(bar: number, verse: number, length: number, beat: number, spectrum?: Spectrum): ShareTiming {
  // The first strong beat at the verse, from the track's measured beat, so every cut (each half bar) lands on one.
  const half = bar / 2
  const start = beat + Math.ceil((verse - 0.2 - beat) / half) * half
  // The chart builds over half a bar, so it lands on a strong beat.
  return { build: half, start, step: half, rounds: 2, beat: bar / 4, length, spectrum }
}

/** Waits for the card's font, so the first frame isn't drawn in the fallback. */
export async function loadShareFonts() {
  // OpenMono alone: loading the stand-ins too would reject where a system font such as Consolas is missing.
  await Promise.all([document.fonts.load(`400 40px "OpenMono"`), document.fonts.load(`700 40px "OpenMono"`)])
}

/** The video's length in seconds: the chart builds, each leading series takes a turn, then the still holds. */
export function shareDuration(card: ShareCard, options: ShareOptions, timing = freeTiming) {
  return mainLength(card, options, timing) + outroBeats * (timing.beat ?? freeBeat)
}

// The card's own part of the video, before the closing slides: with music it runs to the track's drop. Embeds play
// only this part.
export function mainLength(card: ShareCard, options: ShareOptions, timing = freeTiming) {
  const intro = card.chart.kind === "podium" ? (podiumSlides(options, timing)?.end ?? 0) : 0
  return timing.length ?? intro + timing.start + highlights(card, options).length * timing.rounds * timing.step + hold
}

// The leaderboard's slides: the headline until the first cut, then first, second and third place for a bar each with
// music (the cuts on the track's strong beats, where its highlights would fall) or 1.6 s each without. The Build motion
// keeps the card alone.
function podiumSlides(options: ShareOptions, timing: ShareTiming) {
  if (options.motion === "build") return undefined
  const length = timing.beat ? timing.beat * 4 : 1.6
  const grid = timing.beat ? timing.start % length : 0
  const first = grid + length * Math.max(1, Math.ceil((1.4 - grid) / length))
  return { first, length, end: first + length * 3 }
}

// The closing slides, cut on the beat: the lockup large for 4 beats, the line for 3, then the address for 3. At 96 BPM
// that's 6.25 s. Without music they keep 96 BPM's beat.
const outroBeats = 10
const freeBeat = 0.625
// The line on two lines, broken after "inference".
const outroLine = ["The largest inference", "in the world"]
const outroAddress = "opencode.ai"

export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  input: ShareCard,
  options: ShareOptions,
  at: number,
  timing = freeTiming,
) {
  const [width, height] = shareSizes[options.size]
  const look = options.theme === "leader" ? leaderLook(input) : themed(input, palettes[options.theme])
  const colors = look.colors
  const card = look.card
  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, width, height)
  const main = mainLength(card, options, timing)
  const total = shareDuration(card, options, timing)
  // The equaliser waits for the chart to finish building, then eases in over a beat, and plays on through the slides.
  const level =
    timing.beat && at >= timing.build && at < total
      ? scaled(meter(at, timing.beat, timing.spectrum), settle(at, timing.build, timing.beat))
      : undefined
  if (at >= main && at < total) {
    drawOutro(ctx, options, colors, width, height, at - main, timing.beat ?? freeBeat, level)
    ctx.restore()
    return
  }
  // The leaderboard opens with slides (podiumSlides): its headline, then each of the top three on its own. The card
  // proper follows, its own clock starting when they end.
  const slides = card.chart.kind === "podium" ? podiumSlides(options, timing) : undefined
  if (slides && card.chart.kind === "podium" && at < slides.end) {
    drawPodiumSlide(ctx, card, card.chart, options, colors, width, height, at, slides)
    ctx.restore()
    return
  }
  const time = slides ? at - slides.end : at

  // The footer's baseline sits as far from the bottom as its text from the side; the rule is 56px above its type.
  const footer = height - pad
  const rule = footer - 26 - 56
  const legend = card.chart.kind === "stacked" ? legendLayout(card.chart.series, width, height) : undefined
  // A stacked chart keeps one line under it (the total, then each series in turn) while it builds and highlights;
  // once the highlights are done it eases shorter to make room for the full legend. The still is that last state.
  const reveal = legend ? settle(time, highlightsEnd(card, options, timing), 0.8) : 0
  const below = legend ? 96 + (legend.height + 40 - 96) * reveal : 0
  const chartBottom = rule - 64 - below
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
    card.chart.kind === "stacked" ? level : undefined,
  )
  // The equaliser's lit dots inside `clip`, for the muted bars to show; the rest of the grid stays hidden behind them.
  const litDots = (clip: Path2D) => {
    if (!level) return
    ctx.save()
    ctx.clip(clip)
    drawBackground(
      ctx,
      options.background,
      colors,
      width,
      height,
      dotGrid(card.chart, width),
      baseline * 0.4,
      baseline,
      level,
      true,
    )
    ctx.restore()
  }
  // The tall story card is seen smaller in a feed, so its lockup sets larger, and the intro moves down to match.
  const logo = height > 1350 ? 1.5 : 1
  drawLogo(ctx, options.logo, colors, pad, pad, logo)

  const focus = focusAt(card, options, time, timing)
  const top = drawIntro(ctx, card, options, colors, width, pad + 88 + 48 * logo, time)
  const progress = Math.min(1, time / timing.build)

  if (card.chart.kind === "stacked") {
    drawStacked(
      ctx,
      card.chart,
      colors,
      { x: pad, y: top, width: width - pad * 2, height: chartBottom - top },
      progress,
      focus,
      litDots,
    )
    if (legend) {
      drawCallout(ctx, card.chart, legend, colors, pad, chartBottom + 40, focus, 1 - reveal)
      drawLegend(
        ctx,
        card.chart.series,
        legend,
        colors,
        pad,
        chartBottom + 40,
        time - highlightsEnd(card, options, timing),
      )
    }
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

  const box = { x: pad, y: top, width: width - pad * 2, height: chartBottom - top }
  if (card.chart.kind === "podium") drawPodium(ctx, card.chart, colors, box, focus, time)
  if (card.chart.kind === "versus") drawVersus(ctx, card.chart, colors, box, progress, focus, time)

  drawFooter(ctx, card, colors, width, footer, rule)
  ctx.restore()
}

// The closing slides, each cut on a beat with a small punch-in: the OpenCode DATA lockup large in the middle (on the
// track's drop), then the line, then the address. The dot grid fills the card and the equaliser keeps playing.
function drawOutro(
  ctx: CanvasRenderingContext2D,
  options: ShareOptions,
  colors: Palette,
  width: number,
  height: number,
  time: number,
  beat: number,
  level?: (column: number, columns: number) => number,
) {
  drawBackground(
    ctx,
    options.background,
    colors,
    width,
    height,
    { center: width / 2, pitch: 24 },
    height * 0.55,
    height,
    level,
  )
  const slide = time < 4 * beat ? 0 : time < 7 * beat ? 1 : 2
  const since = time - [0, 4, 7][slide]! * beat
  const punch = 1 + 0.05 * (1 - settle(since, 0, 0.35))
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(punch, punch)
  ctx.fillStyle = colors.text
  ctx.textBaseline = "middle"
  if (slide === 0) {
    // The lockup at three times its corner size, centred as a whole.
    const zoom = 3.4
    ctx.font = `700 ${34 * zoom}px ${font}`
    const name = options.logo === "full" ? "OPENCODE DATA" : "DATA"
    const text = [...name].reduce((sum, char) => sum + ctx.measureText(char).width + 34 * zoom * 0.08, 0)
    const total = (40 + 24) * zoom + text
    drawLogo(ctx, options.logo, colors, -total / 2, -24 * zoom, zoom)
  }
  if (slide > 0) {
    // The line and the address share one size, regular weight: the largest at which the line's longer half fits.
    const size = fit(ctx, outroLine[0]!, width - pad * 3.5, 80, 400)
    ctx.font = `400 ${size}px ${font}`
    const lines = slide === 1 ? outroLine : [outroAddress]
    const leading = size * 1.2
    lines.forEach((line, index) =>
      ctx.fillText(line, -ctx.measureText(line).width / 2, (index - (lines.length - 1) / 2) * leading),
    )
  }
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

// When the last highlight lets go: the build alone when there are no highlights.
function highlightsEnd(card: ShareCard, options: ShareOptions, timing: ShareTiming) {
  const count = highlights(card, options).length * timing.rounds
  return count > 0 ? timing.start + count * timing.step : timing.build
}

function highlights(card: ShareCard, options: ShareOptions) {
  // The leaderboard has shown each place on its own slide already.
  if (options.motion === "build" || card.chart.kind === "podium") return []
  const chart = card.chart
  const count =
    chart.kind === "stacked" ? chart.series.filter((item) => item.key !== "other").length : chart.rows.length
  const most = chart.kind === "stacked" || chart.kind === "versus" ? 5 : 3
  return Array.from({ length: Math.min(most, count) }, (_, index) => index)
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
  level?: (column: number, columns: number) => number,
  // Only the equaliser's lit dots, for redrawing them inside the muted bars (drawStacked).
  litOnly = false,
) {
  if (kind === "plain") return
  const end = kind === "band" ? height * 0.28 : fadeEnd
  const { dot, inset, columns, rows, pitch, playing } = dotLayout(width, grid, end)
  // With music, each column is also a bar of an equaliser rising from the x axis: its lit dots climb with its band of
  // the track, bass on the left and treble on the right. Lit dots ignore the fade, so the bars read from the bottom.
  const lit = columns.map((x) => {
    const index = playing.indexOf(x)
    return level && index >= 0 ? Math.round(level(index, playing.length) * rows * 0.85) : 0
  })
  for (let row = 0; row <= rows; row++) {
    const y = inset + row * pitch
    const fade = kind === "band" ? Math.max(0, 1 - y / end) : Math.min(1, Math.max(0, (end - y) / (end - fadeStart)))
    columns.forEach((x, index) => {
      const on = rows - row < (lit[index] ?? 0)
      if (litOnly && !on) return
      ctx.globalAlpha = on ? 0.25 : fade
      ctx.fillStyle = on ? colors.meter : colors.dot
      ctx.fillRect(x, y, dot, dot)
    })
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = colors.dot
  if (kind !== "band" || litOnly) return
  columns.forEach((x) => ctx.fillRect(x, height - inset - dot, dot, dot))
}

// The banner's dot grid (og/card.ts), on the chart's own pitch: square dots on square cells. The first row sits as far
// from the top as the first column from the side; the rows run to `end` (the x axis), the last row's foot exactly on
// it, their pitch stretched by a fraction of a pixel to land there. The playing columns are those behind the chart,
// never the gutters either side of it.
function dotLayout(width: number, grid: { center: number; pitch: number }, end: number) {
  const dot = Math.min(8, Math.max(4, Math.round(grid.pitch * 0.36)))
  const first = grid.center - Math.floor(grid.center / grid.pitch) * grid.pitch
  const inset = Math.max(0, first - dot / 2)
  const columns = Array.from(
    { length: Math.floor((width - inset - dot) / grid.pitch) + 1 },
    (_, index) => inset + index * grid.pitch,
  )
  const rows = Math.max(1, Math.round((end - dot - inset) / grid.pitch))
  const pitch = (end - dot - inset) / rows
  const playing = columns.filter((x) => x >= pad && x + dot <= width - pad)
  return { dot, inset, columns, rows, pitch, playing }
}

// A highlighted series' colour: its own, or in the Top style white for every series but the winner, whose grey would
// sink into the dimmed greys around it.
function spotlit(color: string, series: number, amount: number, colors: Palette) {
  return colors.spotlight && series > 0 ? mix(color, colors.spotlight, amount) : color
}

function scaled(level: (column: number, columns: number) => number, amount: number) {
  return (column: number, columns: number) => level(column, columns) * amount
}

// The equaliser's level for each dot column at `time`: the track's own spectrum once it's measured (spectrum.ts);
// until then a stand-in that jumps on every beat and falls away before the next, higher on the
// first beat of a bar. A rolling wave across the columns, roughened per beat, so neighbours move together like an
// equaliser. Deterministic, so the preview and the export match frame for frame.
function meter(time: number, beat: number, spectrum?: Spectrum) {
  if (spectrum) return (column: number, columns: number) => spectrumLevel(spectrum, time, column, columns)
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
function drawLogo(
  ctx: CanvasRenderingContext2D,
  kind: ShareOptions["logo"],
  colors: Palette,
  x: number,
  y: number,
  zoom: number,
) {
  const size = 48 * zoom
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
  ctx.font = `700 ${34 * zoom}px ${font}`
  spaced(ctx, kind === "full" ? "OPENCODE DATA" : "DATA", x + (40 + 24) * zoom, y + size / 2 + zoom, 34 * zoom * 0.08)
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
    // On the shorter cards the number and its caption set smaller, so the chart still has room.
    const compact = ctx.canvas.height <= 1080
    // Regular, not bold: OpenMono ships no lighter weight, and the number reads cleaner without the extra weight.
    const size = fit(ctx, card.stat.value, max, compact ? 112 : 200, 400)
    const label = compact ? 28 : 34
    const leading = compact ? 36 : 44
    const gap = compact ? 52 : 64
    ctx.fillStyle = colors.highlight
    ctx.font = `400 ${size}px ${font}`
    odometer(ctx, card.stat.value, pad - size * 0.04, y + gap + size * 0.8, size, time)
    ctx.font = `400 ${label}px ${font}`
    const lines = balance(ctx, card.stat.label, max).slice(0, 2)
    const first = y + gap + size * 0.8 + gap
    lines.forEach((line, index) =>
      rise(ctx, time, 0.3 + index * 0.07, first + index * leading, label, () => {
        ctx.fillStyle = colors.muted
        ctx.font = `400 ${label}px ${font}`
        ctx.fillText(line, pad, first + index * leading)
      }),
    )
    return first + lines.length * leading + room(ctx) - 8
  }

  if (options.layout === "chart") {
    const size = fit(ctx, card.title, max, 88, 400)
    rise(ctx, time, 0.14, y + 64 + size * 0.8, size, () => {
      ctx.fillStyle = colors.text
      ctx.font = `400 ${size}px ${font}`
      ctx.fillText(card.title, pad - 2, y + 64 + size * 0.8)
    })
    return y + 64 + size + room(ctx)
  }

  const size =
    (ctx.canvas.height <= 1080 ? [52, 46, 40] : [64, 56, 50, 44]).find((value) => {
      ctx.font = `400 ${value}px ${font}`
      return wrap(ctx, card.headline, max).length <= 3
    }) ?? 44
  ctx.font = `400 ${size}px ${font}`
  const lines = balance(ctx, card.headline, max).slice(0, 4)
  const leading = size * 1.18
  // Where the winner's name falls in the headline, counted across its lines (they join with single spaces).
  const words = lines.join(" ")
  const from = card.highlight ? words.indexOf(card.highlight) : -1
  const to = from + (card.highlight?.length ?? 0)
  lines.forEach((line, index) => {
    const offset = lines.slice(0, index).reduce((sum, item) => sum + item.length + 1, 0)
    rise(ctx, time, 0.14 + index * 0.08, y + 56 + size * 0.8 + index * leading, size, () => {
      ctx.font = `400 ${size}px ${font}`
      const start = Math.max(0, from - offset)
      const end = Math.min(line.length, to - offset)
      const parts = from >= 0 && end > start ? [line.slice(0, start), line.slice(start, end), line.slice(end)] : [line]
      parts.reduce((x, part, slot) => {
        ctx.fillStyle = parts.length === 3 && slot === 1 ? colors.highlight : colors.text
        ctx.fillText(part, x, y + 56 + size * 0.8 + index * leading)
        return x + ctx.measureText(part).width
      }, pad - 2)
    })
  })
  return y + 56 + lines.length * leading + room(ctx)
}

// The space between the intro and the chart: more on the tall story card, whose chart would otherwise press up
// against the headline.
function room(ctx: CanvasRenderingContext2D) {
  return ctx.canvas.height > 1350 ? 112 : 64
}

// The big number rolling into place like an odometer: each digit spins up through 0 to 9 and settles on its own, the
// right-hand digits turning over more times than the left, as a real counter's wheels do. Other characters (the
// unit, a decimal point, a currency sign) stand still. OpenMono's fixed advance keeps every wheel in its column.
function odometer(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  baseline: number,
  size: number,
  time: number,
) {
  const chars = [...value]
  const advance = ctx.measureText("0").width
  const pitch = size * 1.05
  ctx.save()
  ctx.beginPath()
  // A window one digit tall, so the wheels' other numbers stay hidden above and below it.
  ctx.rect(x - size * 0.1, baseline - size * 0.8, advance * chars.length + size * 0.2, size * 0.86)
  ctx.clip()
  chars.reduce((wheel, char, index) => {
    const left = x + index * advance
    if (!/\d/.test(char)) {
      ctx.globalAlpha = settle(time, 0.1, 0.5)
      ctx.fillText(char, left, baseline)
      ctx.globalAlpha = 1
      return wheel
    }
    // Wheels land left to right, each a beat after the last, on a long, steep ease-out: they race at first, then crawl
    // the last few digits into place.
    const progress = Math.max(0, Math.min(1, (time - 0.1) / (1.6 + wheel * 0.35)))
    const turned = 1 - (1 - progress) ** 6
    const travel = (Number(char) + 10 * (wheel + 2)) * turned
    const shown = Math.floor(travel)
    const offset = (travel - shown) * pitch
    ctx.fillText(String(shown % 10), left, baseline - offset)
    if (offset > 0) ctx.fillText(String((shown + 1) % 10), left, baseline - offset + pitch)
    return wheel + 1
  }, 0)
  ctx.restore()
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

type Segment = { rect: readonly [number, number, number, number]; color: string; muted: number }

function drawStacked(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "stacked" }>,
  colors: Palette,
  box: Box,
  progress: number,
  focus: Focus,
  litDots: (clip: Path2D) => void,
) {
  // Room above the bars for the focused series' label.
  // A little room between the intro and the tallest column.
  const headroom = 24
  const plot = { ...box, y: box.y + headroom, height: box.height - axisHeight - headroom }
  const count = chart.columns.length
  const totals = chart.columns.map((column) => column.values.reduce((sum, value) => sum + value, 0))
  const max = Math.max(1, ...totals)
  const slot = plot.width / Math.max(1, count)
  const gap = Math.min(10, Math.max(2, slot * 0.22))
  const base = plot.y + plot.height

  // Each bar's segments, drawn in three passes: under the muted ones the card's background, so the dot grid doesn't
  // show through; then, with music, the equaliser's lit dots inside them; then every segment's colour, the muted grey
  // as a translucent veil over those dots.
  const segments = chart.columns.flatMap((column, index) => {
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
    return stack.reduce<{ y: number; parts: Segment[] }>(
      (state, series) => {
        const value = column.values[series] ?? 0
        if (value <= 0 || total <= 0) return state
        const size = (value / total) * height
        const own = chart.series[series]?.color ?? colors.idle
        // How far the bar has gone to the muted grey: "Other" always, the rest as another series takes the focus.
        const muted = series === focus.index ? 0 : own === colors.other ? 1 : focus.amount
        const rect = [x, state.y - size, width, Math.max(0, size - (size > 3 ? 1 : 0))] as const
        const color = series === focus.index ? spotlit(own, series, focus.amount, colors) : own
        return { y: state.y - size, parts: [...state.parts, { rect, color, muted }] }
      },
      { y: base, parts: [] },
    ).parts
  })
  const alpha = ctx.globalAlpha
  const quiet = segments.filter((segment) => segment.muted > 0)
  quiet.forEach((segment) => {
    ctx.globalAlpha = alpha * segment.muted
    ctx.fillStyle = colors.background
    ctx.fillRect(...segment.rect)
  })
  ctx.globalAlpha = alpha
  if (quiet.length > 0)
    litDots(
      quiet.reduce((path, segment) => {
        path.rect(...segment.rect)
        return path
      }, new Path2D()),
    )
  segments.forEach((segment) => {
    if (segment.muted < 1) {
      ctx.globalAlpha = alpha * (1 - segment.muted)
      ctx.fillStyle = segment.color
      ctx.fillRect(...segment.rect)
    }
    if (segment.muted > 0) {
      ctx.globalAlpha = alpha * segment.muted
      ctx.fillStyle = colors.veil
      ctx.fillRect(...segment.rect)
    }
  })
  ctx.globalAlpha = alpha

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

// On the shorter cards (1:1 and 16:9) the legend sets smaller and tighter, so the chart keeps its height.
function legendLayout(series: ShareSeries[], width: number, height: number) {
  const columns = width > 1400 ? 3 : 2
  const rows = Math.ceil(series.length / columns)
  const compact = height <= 1080
  const row = compact ? 34 : 48
  return {
    columns,
    rows,
    row,
    size: compact ? 19 : 24,
    swatch: compact ? 14 : 18,
    column: (width - pad * 2) / columns,
    height: rows * row,
  }
}

// The one line under the chart while it builds and highlights: the total, then each series as it's highlighted,
// crossfading between them. `shown` fades the whole line out as the legend takes over.
function drawCallout(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "stacked" }>,
  layout: ReturnType<typeof legendLayout>,
  colors: Palette,
  x: number,
  y: number,
  focus: Focus,
  shown: number,
) {
  if (shown <= 0) return
  const focused = chart.series[focus.index]
  const width = layout.column * layout.columns
  const middle = y + 36
  const line = (amount: number, label: string, value: string, color?: string) => {
    if (amount <= 0) return
    ctx.save()
    ctx.globalAlpha = amount * shown
    ctx.textBaseline = "middle"
    // Set as the footer is: the label as the address (bold 34px), the amount as the date (34px's companion, 30px).
    ctx.font = `400 30px ${font}`
    const measured = ctx.measureText(value).width
    // The amount in the legend's lighter grey, as its values are.
    ctx.fillStyle = colors.muted
    ctx.fillText(value, x + width - measured, middle + 2)
    ctx.font = `700 34px ${font}`
    const left = color ? x + 22 + 16 : x
    if (color) {
      ctx.fillStyle = color
      ctx.fillRect(x, middle - 11, 22, 22)
    }
    ctx.fillStyle = colors.text
    ctx.fillText(truncate(ctx, label, x + width - measured - 40 - left), left, middle + 2)
    ctx.restore()
  }
  line(1 - (focused ? focus.amount : 0), chart.total.label, chart.total.value)
  if (focused) line(focus.amount, focused.label, focused.value, spotlit(focused.color, focus.index, 1, colors))
}

// The full legend, each entry rising in turn once the highlights are done (`since` is the time since then; the still
// passes Infinity).
function drawLegend(
  ctx: CanvasRenderingContext2D,
  series: ShareSeries[],
  layout: ReturnType<typeof legendLayout>,
  colors: Palette,
  x: number,
  y: number,
  since: number,
) {
  if (since < 0) return
  ctx.save()
  ctx.textBaseline = "middle"
  series.forEach((item, index) => {
    const column = Math.floor(index / layout.rows)
    const row = index % layout.rows
    const left = x + column * layout.column
    const middle = y + row * layout.row + layout.row / 2
    // Down each column in turn, starting as the chart begins to make room.
    const amount = settle(since, 0.25 + index * 0.07, 0.6)
    if (amount <= 0) return
    ctx.save()
    ctx.globalAlpha = amount
    ctx.translate(0, (1 - amount) * 14)
    ctx.fillStyle = item.color
    ctx.fillRect(left, middle - layout.swatch / 2, layout.swatch, layout.swatch)
    ctx.font = `400 ${layout.size}px ${font}`
    ctx.fillStyle = colors.muted
    const measured = ctx.measureText(item.value).width
    const right = left + layout.column - (column === layout.columns - 1 ? 0 : 48)
    ctx.fillText(item.value, right - measured, middle)
    ctx.fillStyle = colors.text
    ctx.fillText(
      truncate(ctx, item.label, right - measured - 24 - (left + layout.swatch + 20)),
      left + layout.swatch + 20,
      middle,
    )
    ctx.restore()
  })
  ctx.restore()
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
  const { rows, row, size } = rankedRows(chart, box)
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
    ctx.fillStyle = mix(index === 0 ? colors.lead : colors.accent, colors.idle, dim)
    ctx.fillRect(box.x + 72, bar, (box.width - 72) * Math.max(0.01, Math.min(1, item.fill)) * grow, 10)
    ctx.restore()
  })
}

// How many rows fit, how tall each is and the type size.
// One of the leaderboard's slides: before the first cut its headline, large; then a place alone on a tile the size of
// the chart, its logo large and faint at the right, punching in on the cut.
function drawPodiumSlide(
  ctx: CanvasRenderingContext2D,
  card: ShareCard,
  chart: Extract<ShareChart, { kind: "podium" }>,
  options: ShareOptions,
  colors: Palette,
  width: number,
  height: number,
  time: number,
  slides: { first: number; length: number },
) {
  drawBackground(
    ctx,
    options.background,
    colors,
    width,
    height,
    { center: width / 2, pitch: 24 },
    height * 0.55,
    height,
  )
  const zoom = height > 1350 ? 1.5 : 1
  drawLogo(ctx, options.logo, colors, pad, pad, zoom)
  const footer = height - pad
  const rule = footer - 26 - 56
  drawFooter(ctx, card, colors, width, footer, rule)
  const box = { x: pad, y: pad + 88 + 48 * zoom, width: width - pad * 2, height: rule - 64 - (pad + 88 + 48 * zoom) }
  const index =
    time < slides.first ? -1 : Math.min(chart.entries.length - 1, Math.floor((time - slides.first) / slides.length))
  const since = index < 0 ? time : time - slides.first - index * slides.length
  const entry = chart.entries[index]
  ctx.textBaseline = "alphabetic"

  if (!entry) {
    // The headline, as large as fits in five lines, set in the middle of the space, under its eyebrow.
    const sizes = width > height ? [96, 84, 72, 64] : [104, 92, 80, 72, 64, 56]
    const size =
      sizes.find((value) => {
        ctx.font = `400 ${value}px ${font}`
        return wrap(ctx, card.headline, box.width).length <= 5
      }) ?? 56
    ctx.font = `400 ${size}px ${font}`
    const lines = balance(ctx, card.headline, box.width).slice(0, 5)
    const leading = size * 1.15
    const block = 44 + lines.length * leading
    const top = box.y + (box.height - block) / 2
    rise(ctx, since, 0.05, top + 22, 28, () => {
      ctx.font = `400 28px ${font}`
      ctx.fillStyle = colors.faint
      spaced(ctx, `${card.title} · ${card.range}`.toUpperCase(), pad, top + 22, 28 * 0.12)
    })
    lines.forEach((line, row) =>
      rise(ctx, since, 0.15 + row * 0.08, top + 44 + size * 0.8 + row * leading, size, () => {
        ctx.font = `400 ${size}px ${font}`
        ctx.fillStyle = colors.text
        ctx.fillText(line, pad - 2, top + 44 + size * 0.8 + row * leading)
      }),
    )
    return
  }

  const punch = 1 + 0.04 * (1 - settle(since, 0, 0.4))
  const dark = colors.background !== palettes.light.background
  ctx.save()
  ctx.translate(box.x + box.width / 2, box.y + box.height / 2)
  ctx.scale(punch, punch)
  ctx.translate(-(box.x + box.width / 2), -(box.y + box.height / 2))
  ctx.globalAlpha = 0.55
  ctx.fillStyle = colors.track
  ctx.fillRect(box.x, box.y, box.width, box.height)
  ctx.globalAlpha = 1
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 2
  ctx.strokeRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2)
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.width, box.height)
  ctx.clip()
  const logo = shareLogo(entry.logo, dark)
  if (logo) {
    const size = Math.min(box.height * 0.95, box.width * 0.9)
    ctx.globalAlpha = dark ? 0.08 : 0.07
    ctx.drawImage(logo, box.x + box.width - size * 0.72, box.y + (box.height - size) / 2, size, size)
    ctx.globalAlpha = 1
  }
  // Bottom up: the change beside the tokens on their baseline (under them when there's no room), the tokens' caption
  // over them, the provider with its logo, the name; the place large and faint in the top corner.
  const inset = 64
  const left = box.x + inset
  const room = box.width - inset * 2
  const bottom = box.y + box.height - inset
  const place = Math.min(200, box.height * 0.22)
  const number = Math.min(220, box.height * 0.24, fit(ctx, entry.value, room * 0.62, 220, 400))
  ctx.font = `400 ${number}px ${font}`
  const numberWidth = ctx.measureText(entry.value).width
  const change = Math.round(number * 0.34)
  ctx.font = `400 ${change}px ${font}`
  const beside = numberWidth + 40 + ctx.measureText(entry.change).width <= room
  const numberY = beside ? bottom : bottom - change - 24
  const captionY = numberY - number * 0.78 - 32
  const providerY = captionY - 24 - 64
  const name = Math.min(96, fit(ctx, entry.label, room, 96, 700))
  const nameY = providerY - 40 - 28
  rise(ctx, since, 0.04, box.y + inset + place * 0.78, place, () => {
    ctx.font = `400 ${place}px ${font}`
    ctx.fillStyle = colors.mark
    ctx.fillText(entry.place, left - place * 0.06, box.y + inset + place * 0.78)
  })
  rise(ctx, since, 0.12, nameY, name, () => {
    ctx.font = `700 ${name}px ${font}`
    ctx.fillStyle = colors.text
    ctx.fillText(entry.label, left - 2, nameY)
  })
  rise(ctx, since, 0.18, providerY, 40, () => {
    const mark = shareLogo(entry.logo, dark)
    const shift = mark && entry.provider ? 56 : 0
    if (mark && entry.provider) ctx.drawImage(mark, left, providerY - 36, 40, 40)
    ctx.font = `400 40px ${font}`
    ctx.fillStyle = colors.muted
    ctx.fillText(entry.provider, left + shift, providerY)
  })
  rise(ctx, since, 0.24, captionY, 24, () => {
    ctx.font = `400 24px ${font}`
    ctx.fillStyle = colors.faint
    spaced(ctx, `TOKENS · ${card.range}`.toUpperCase(), left, captionY, 24 * 0.14)
  })
  rise(ctx, since, 0.3, numberY, number, () => {
    ctx.font = `400 ${number}px ${font}`
    ctx.fillStyle = colors.text
    ctx.fillText(entry.value, left - number * 0.04, numberY)
  })
  const changeX = beside ? left + numberWidth + 40 : left
  const changeY = beside ? numberY : bottom
  rise(ctx, since, 0.4, changeY, change, () => {
    ctx.font = `400 ${change}px ${font}`
    ctx.fillStyle = entry.tone === "down" ? colors.down : entry.tone === "flat" ? colors.faint : colors.up
    ctx.fillText(entry.change, changeX, changeY)
  })
  ctx.restore()
}

// The top three as tiles: stacked on the tall cards, side by side on the wide one. Each rises in in turn, its
// provider's logo large and faint, cropped by the tile's right edge; a highlighted tile keeps its colour while the
// others fade back.
function drawPodium(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "podium" }>,
  colors: Palette,
  box: Box,
  focus: Focus,
  time: number,
) {
  const gap = 20
  const across = box.width > box.height * 1.6
  const count = chart.entries.length
  const tile = across
    ? { width: (box.width - gap * (count - 1)) / count, height: Math.min(box.height, 340) }
    : { width: box.width, height: Math.min(260, (box.height - gap * (count - 1)) / count) }
  const dark = colors.background !== palettes.light.background
  chart.entries.forEach((entry, index) => {
    const x = box.x + (across ? index * (tile.width + gap) : 0)
    const y = box.y + (across ? 0 : index * (tile.height + gap))
    const amount = settle(time, 0.15 + index * 0.12, 0.7)
    if (amount <= 0) return
    const dim = index === focus.index ? 0 : focus.amount
    ctx.save()
    ctx.globalAlpha = amount
    ctx.translate(0, (1 - amount) * 24)
    ctx.fillStyle = colors.track
    ctx.globalAlpha = amount * 0.55
    ctx.fillRect(x, y, tile.width, tile.height)
    ctx.globalAlpha = amount
    ctx.strokeStyle =
      index === focus.index && focus.amount > 0 ? mix(colors.line, colors.faint, focus.amount) : colors.line
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, tile.width - 2, tile.height - 2)
    ctx.beginPath()
    ctx.rect(x, y, tile.width, tile.height)
    ctx.clip()
    const logo = shareLogo(entry.logo, dark)
    if (logo) {
      const size = tile.height * 1.15
      ctx.globalAlpha = amount * (dark ? 0.07 : 0.06)
      ctx.drawImage(logo, x + tile.width - size * 0.78, y + (tile.height - size) / 2, size, size)
      ctx.globalAlpha = amount
    }
    const inset = across ? 32 : 36
    const size = across ? 34 : Math.min(44, tile.height * 0.19)
    const small = Math.round(size * 0.72)
    ctx.textBaseline = "alphabetic"
    ctx.font = `400 ${small}px ${font}`
    ctx.fillStyle = colors.faint
    ctx.fillText(entry.place, x + inset, y + inset + small * 0.8)
    // The name and provider at the foot on the left; the tokens and change at the foot on the right.
    const foot = y + tile.height - inset
    ctx.font = `400 ${small}px ${font}`
    const value = ctx.measureText(entry.value).width
    const change = ctx.measureText(entry.change).width
    const right = x + tile.width - inset
    ctx.fillStyle = mix(colors.text, colors.faint, dim)
    ctx.fillText(entry.value, right - value, foot - size * 1.25)
    ctx.fillStyle = mix(
      entry.tone === "down" ? colors.down : entry.tone === "flat" ? colors.faint : colors.up,
      colors.faint,
      dim,
    )
    ctx.fillText(entry.change, right - change, foot)
    ctx.fillStyle = mix(colors.muted, colors.faint, dim)
    ctx.fillText(truncate(ctx, entry.provider, tile.width - inset * 2 - change - 24), x + inset, foot)
    ctx.font = `700 ${size}px ${font}`
    ctx.fillStyle = mix(colors.text, colors.faint, dim)
    ctx.fillText(truncate(ctx, entry.label, tile.width - inset * 2 - value - 24), x + inset, foot - size * 1.25)
    ctx.restore()
  })
}

// Two models head to head: their names over their logos, large and faint, one each side; then a row a metric, its
// name in the middle and each model's bar growing out from it, the one the metric favours in colour.
function drawVersus(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "versus" }>,
  colors: Palette,
  box: Box,
  progress: number,
  focus: Focus,
  time: number,
) {
  const dark = colors.background !== palettes.light.background
  const middle = box.x + box.width / 2
  const half = box.width / 2
  const head = Math.min(150, box.height * 0.26)
  const name = Math.min(
    40,
    fit(ctx, chart.models.reduce((a, b) => (a.label.length > b.label.length ? a : b)).label, half - 40, 40, 700),
  )
  chart.models.forEach((model, side) => {
    const amount = settle(time, 0.1 + side * 0.1, 0.7)
    if (amount <= 0) return
    const logo = shareLogo(model.logo, dark)
    ctx.save()
    ctx.globalAlpha = amount
    if (logo) {
      const size = head * 1.7
      ctx.save()
      ctx.beginPath()
      ctx.rect(side === 0 ? 0 : middle, box.y - 40, side === 0 ? middle : ctx.canvas.width - middle, head + 80)
      ctx.clip()
      ctx.globalAlpha = amount * (dark ? 0.07 : 0.06)
      ctx.drawImage(
        logo,
        side === 0 ? box.x - size * 0.2 : box.x + box.width - size * 0.8,
        box.y + head / 2 - size / 2,
        size,
        size,
      )
      ctx.restore()
    }
    ctx.textBaseline = "alphabetic"
    const align = (text: string) => (side === 0 ? box.x : box.x + box.width - ctx.measureText(text).width)
    ctx.font = `700 ${name}px ${font}`
    ctx.fillStyle = colors.text
    const label = truncate(ctx, model.label, half - 40)
    ctx.translate(0, (1 - amount) * 20)
    ctx.fillText(label, align(label), box.y + head * 0.5)
    ctx.font = `400 ${Math.round(name * 0.72)}px ${font}`
    ctx.fillStyle = colors.muted
    ctx.fillText(model.provider, align(model.provider), box.y + head * 0.5 + name * 1.2)
    ctx.restore()
  })
  ctx.font = `400 26px ${font}`
  ctx.fillStyle = colors.faint
  ctx.globalAlpha = settle(time, 0.2, 0.6)
  ctx.fillText("vs", middle - ctx.measureText("vs").width / 2, box.y + head * 0.5)
  ctx.globalAlpha = 1

  const top = box.y + head + 24
  const row = Math.min(120, (box.y + box.height - top) / Math.max(1, chart.rows.length))
  const grow = ease(Math.min(1, progress))
  chart.rows.forEach((item, index) => {
    const y = top + index * row
    const dim = index === focus.index ? 0 : focus.amount
    const amount = settle(time, 0.25 + index * 0.06, 0.6)
    if (amount <= 0) return
    ctx.save()
    ctx.globalAlpha = amount
    ctx.font = `400 22px ${font}`
    ctx.fillStyle = mix(colors.faint, colors.mark, dim)
    const label = item.label.toUpperCase()
    spaced(ctx, label, middle - (ctx.measureText(label).width + label.length * 2) / 2, y + 22, 2)
    const bar = y + 52
    const reach = half - 8
    item.values.forEach((value, side) => {
      const lead = item.lead === side
      const fill = Math.max(0.02, Math.min(1, item.fills[side] ?? 0)) * reach * grow
      ctx.fillStyle = colors.track
      ctx.fillRect(side === 0 ? middle - 4 - reach : middle + 4, bar, reach, 10)
      ctx.fillStyle = mix(lead ? colors.lead : colors.idle, colors.idle, dim)
      ctx.fillRect(side === 0 ? middle - 4 - fill : middle + 4, bar, fill, 10)
      ctx.font = `${lead ? 700 : 400} 30px ${font}`
      ctx.fillStyle = mix(lead ? colors.text : colors.muted, colors.faint, dim)
      ctx.fillText(value, side === 0 ? box.x : box.x + box.width - ctx.measureText(value).width, y + 24)
    })
    ctx.restore()
  })
}

function rankedRows(chart: Extract<ShareChart, { kind: "ranked" }>, box: Box) {
  const rows = chart.rows.slice(0, Math.max(1, Math.floor(box.height / 72)))
  const row = Math.min(112, box.height / Math.max(1, rows.length))
  return { rows, row, size: row >= 96 ? 30 : 26 }
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
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    date,
  )
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
