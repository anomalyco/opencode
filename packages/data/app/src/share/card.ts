// The share card: one section of the home page as a branded image, drawn on a canvas so the preview, the PNG and
// every frame of the video come from the same code. drawShareCard(ctx, card, options, time) draws the card as it
// looks `time` seconds into its animation; time past shareDuration() is the still, which is also the PNG.

import { translate } from "../i18n"
import { dir, tag, type Locale } from "../lib/language"
import { shareLogo } from "./logos"
import { spectrumLevel, type Spectrum } from "./spectrum"

export type ShareSeries = { key: string; label: string; color: string; value: string }

export type ShareChart =
  | {
      kind: "stacked"
      // Market share: each column fills the chart height.
      normalized: boolean
      series: ShareSeries[]
      // values[i] is series[i]'s value in the column; series[0] stacks at the bottom. `start` is its first day
      // (YYYY-MM-DD), for the editor's calendar.
      columns: { label: string; values: number[]; start?: string }[]
      // The line under the chart before a series takes it, such as the latest column's total.
      total: { label: string; value: string }
      // A card about one column (a day or a week): its index. The other columns go grey, and the series values, the
      // total and the leader are that column's.
      day?: number
      // Drawn as a race of horizontal bars overtaking each other day by day instead of bars (drawRace); a one-day
      // chart (day set) may instead be a ranked list or a dot matrix (drawDay).
      style?: "race" | "list" | "dots"
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
      // fills: each value against the larger, for the bars; scores: each against the better (1 is the better), for the
      // radar, so the better model reaches the edge whichever way the measure runs.
      rows: { label: string; values: string[]; fills: number[]; scores: number[]; lead: number }[]
    }

export type Tone = "up" | "down" | "new" | "flat"

export type ShareCard = {
  id: string
  // The language of the card's words, including those the card draws itself (the footer, the closing line).
  locale: Locale
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
    // The grid, bright enough to read with its small dots.
    dot: "#2a2a2a",
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
    // The two models of a comparison, as the comparison page's radar colours them.
    first: "#6b8fff",
    second: "#3fbf7f",
  },
  light: {
    background: "#fbfbfb",
    text: "#161616",
    muted: "#3a3a3a",
    faint: "#6b6b6b",
    line: "#0000001a",
    dot: "#e0e0e0",
    meter: "#3a3a3a",
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
    first: "#294bdb",
    second: "#159447",
  },
}

type Palette = (typeof palettes)["dark"]

/** The colour the Leader style takes: the leading series' colour, or the site's accent for a ranked list. */
export function leaderColor(card: Pick<ShareCard, "chart">) {
  return card.chart.kind === "stacked" ? (card.chart.series[leaderIndex(card.chart)]?.color ?? "#a684ff") : "#a684ff"
}

// The leading series: the first, or on a card about one column, the named series with the most in it.
function leaderIndex(chart: Extract<ShareChart, { kind: "stacked" }>) {
  const column = chart.day === undefined ? undefined : chart.columns[chart.day]
  if (!column) return 0
  return chart.series.reduce(
    (best, item, index) =>
      item.key !== "other" && (column.values[index] ?? 0) > (column.values[best] ?? 0) ? index : best,
    0,
  )
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
    dot: hex(base.background, color, 0.2),
    meter: color,
    accent: grey(0.3),
    lead: color,
    highlight: color,
    spotlight: "#ffffff",
  }
  if (card.chart.kind !== "stacked") return { colors, card }
  const steps = [1, 0.36, 0.29, 0.23, 0.19, 0.16]
  const lead = leaderIndex(card.chart)
  const series = card.chart.series.map((item, index) => ({
    ...item,
    color:
      index === lead
        ? item.color
        : item.key === "other"
          ? grey(0.12)
          : grey(steps[index < lead ? index + 1 : index] ?? 0.14),
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

// OpenMono has no Arabic, and a monospace fallback stretches Arabic letters to fill its cells, so Arabic falls back to
// a proportional Arabic face first.
const font =
  '"OpenMono", "OpenMono Menlo", "OpenMono Consolas", "OpenMono Courier", "Geeza Pro", "Noto Sans Arabic", ui-monospace, monospace'
const pad = 80
// The still holds long enough for the legend to arrive after the highlights.
const hold = 2.2
// The space under a stacked chart for its date labels.
const axisHeight = 44

// When the chart builds, when the highlights start and how long each takes. Without
// music it runs at its own pace; with a soundtrack it follows the track (barTiming) and `beat` drives the dot meter.
export type ShareTiming = {
  build: number
  start: number
  step: number
  beat?: number
  length?: number
  spectrum?: Spectrum
}
const freeTiming: ShareTiming = { build: 0.8, start: 1, step: 1.1 }

/**
 * The chart builds over the first bar; from the verse each highlight takes half a bar, once along the chart; the dots
 * pulse on every beat; the video ends with the track.
 */
export function barTiming(bar: number, verse: number, length: number, beat: number, spectrum?: Spectrum): ShareTiming {
  // The first strong beat at the verse, from the track's measured beat, so every cut (each half bar) lands on one.
  const half = bar / 2
  const start = beat + Math.ceil((verse - 0.2 - beat) / half) * half
  // The chart builds over half a bar, so it lands on a strong beat.
  return { build: half, start, step: half, beat: bar / 4, length, spectrum }
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
  const intro = introSlides(card, options, timing)?.end ?? 0
  // A race runs to its last day just before the closing slides, so it ends on the finished order, not a long hold.
  const play = isRace(card)
    ? raceLength(card, timing) + raceRest
    : turns(card, options, timing).length * timing.step + hold
  return timing.length ?? intro + timing.start + play
}

// A stacked chart over its whole range drawn as an animation over the days (a race), which takes its own
// time and needs no legend or highlights.
function isRace(card: ShareCard) {
  return card.chart.kind === "stacked" && !!card.chart.style && card.chart.day === undefined
}

// How long the race runs: about a sixth of a second a day, or with music the whole track up to the closing slides,
// so it lands on its last day just as they cut in.
const raceRest = 0.4
function raceLength(card: ShareCard, timing: ShareTiming) {
  const days = card.chart.kind === "stacked" ? card.chart.columns.length : 0
  if (timing.length) return Math.max(2, timing.length - timing.start - raceRest)
  return Math.min(12, Math.max(5, days * 0.16))
}

// The slides the leaderboard and comparison open with: the headline until the first cut, then a slide a place (the top
// three) or two for a comparison (head to head, then the radar, held twice as long), a bar each with music (the cuts on the track's strong
// beats, where its highlights would fall) or 1.6 s each without. The Build motion keeps the card alone.
function introSlides(card: ShareCard, options: ShareOptions, timing: ShareTiming) {
  // Each slide's length in units of one slide; the comparison's radar stays for two, so it can be read.
  const units =
    card.chart.kind === "podium" ? card.chart.entries.map(() => 1) : card.chart.kind === "versus" ? [1, 2] : []
  if (options.motion === "build" || units.length === 0) return undefined
  const length = timing.beat ? timing.beat * 4 : 1.6
  const grid = timing.beat ? timing.start % length : 0
  const first = grid + length * Math.max(1, Math.ceil((1.4 - grid) / length))
  const starts = units.map((_, index) => first + units.slice(0, index).reduce((sum, unit) => sum + unit, 0) * length)
  return { first, starts, end: first + units.reduce((sum, unit) => sum + unit, 0) * length }
}

// The closing slides, cut on the beat: the lockup large for 4 beats, the line for 3, then the address for 3. At 96 BPM
// that's 6.25 s. Without music they keep 96 BPM's beat.
const outroBeats = 10
const freeBeat = 0.625
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
  // Every x is a left edge. Names and numbers run left to right; only the card's sentences (drawIntro, drawSlide) take
  // a right-to-left language's direction, which orders the words within each line.
  ctx.direction = "ltr"
  ctx.textAlign = "left"
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
    drawOutro(ctx, card.locale, options, colors, width, height, at - main, timing.beat ?? freeBeat, level)
    ctx.restore()
    return
  }
  // The leaderboard and comparison open with slides (introSlides). The card proper follows, its own clock starting when
  // they end.
  const slides = introSlides(card, options, timing)
  if (slides && at < slides.end) {
    drawSlide(ctx, card, options, colors, width, height, at, slides)
    veilIn(ctx, colors, width, height, at)
    ctx.restore()
    return
  }
  const time = slides ? at - slides.end : at

  // The footer's baseline sits as far from the bottom as its text from the side; the rule is 56px above its type.
  const footer = height - pad
  const rule = footer - 26 - 56
  // A race names its own rows, so it needs no legend under it.
  const race = isRace(card)
  const legend = card.chart.kind === "stacked" && !race ? legendLayout(card.chart.series, width, height) : undefined
  // A stacked chart keeps one line under it (the total, then each series in turn) while it builds and highlights;
  // once the highlights are done it eases shorter to make room for the full legend. The still is that last state.
  const reveal = legend ? settle(time, highlightsEnd(card, options, timing), 0.8) : 0
  const below = legend ? 96 + (legend.height + 40 - 96) * reveal : 0
  const chartBottom = rule - 64 - below
  // The dots are gone by the x axis: a stacked chart's baseline sits its axis labels above the chart's bottom.
  const baseline = card.chart.kind === "stacked" && !race ? chartBottom - axisHeight : chartBottom
  drawBackground(
    ctx,
    options.background,
    colors,
    width,
    height,
    dotGrid(card.chart, width),
    baseline * 0.4,
    baseline,
    // The equaliser plays behind bar charts, but not a race or the dot matrix, which are busy enough.
    card.chart.kind === "stacked" && !race && card.chart.style !== "dots" ? level : undefined,
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
  ctx.direction = dir(card.locale)
  const top = drawIntro(ctx, card, options, colors, width, pad + 88 + 48 * logo, time)
  ctx.direction = "ltr"
  const progress = Math.min(1, time / timing.build)

  if (card.chart.kind === "stacked" && race && card.chart.style === "race")
    drawRace(
      ctx,
      card.chart,
      colors,
      { x: pad, y: top, width: width - pad * 2, height: chartBottom - top },
      time,
      timing,
      raceLength(card, timing),
    )
  if (card.chart.kind === "stacked" && !race) {
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
  if (card.chart.kind === "versus") drawVersus(ctx, card.locale, card.chart, colors, box, progress, focus, time)

  drawFooter(ctx, card, colors, width, footer, rule)
  veilIn(ctx, colors, width, height, at)
  ctx.restore()
}

// A video opens on a blank card: everything on it, the grid, the lockup and the footer too, fades up from the card's
// background over the first moments, as the text rises and the chart builds.
function veilIn(ctx: CanvasRenderingContext2D, colors: Palette, width: number, height: number, time: number) {
  if (time >= 0.45) return
  ctx.save()
  ctx.globalAlpha = (1 - Math.max(0, time) / 0.45) ** 2
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

// The closing slides, each a hard cut on a beat: the OpenCode DATA lockup large in the middle (on the
// track's drop), then the line, then the address. The dot grid fills the card and the equaliser keeps playing.
function drawOutro(
  ctx: CanvasRenderingContext2D,
  locale: Locale,
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
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.fillStyle = colors.text
  ctx.textBaseline = "middle"
  if (slide === 0) {
    // The lockup at three times its corner size, centred as a whole.
    const zoom = 3.4
    ctx.font = `700 ${34 * zoom}px ${font}`
    const name = options.logo === "full" ? "OPENCODE DATA" : "DATA"
    const text = [...name].reduce((sum, char) => sum + ctx.measureText(char).width + 34 * zoom * 0.08, 0)
    const total = (40 + 16) * zoom + text
    drawLogo(ctx, options.logo, colors, -total / 2, -24 * zoom, zoom)
  }
  if (slide > 0) {
    // The line (on two lines, where the translation breaks it) and the address share one size, regular weight: the
    // largest at which the line's longer half fits.
    const outroLine = translate(locale, "share.card.outro").split("\n")
    ctx.font = `400 80px ${font}`
    const longest = outroLine.reduce((a, b) => (ctx.measureText(b).width > ctx.measureText(a).width ? b : a))
    const size = fit(ctx, longest, width - pad * 3.5, 80, 400)
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
  const order = turns(card, options, timing)
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
  if (isRace(card)) return timing.start + raceLength(card, timing)
  const count = turns(card, options, timing).length
  return count > 0 ? timing.start + count * timing.step : timing.build
}

// The highlights in turn: each bar of the chart once, first to last. With music the video ends with the track, so a long
// list stops where the rest would run past it, leaving the legend its moment.
function turns(card: ShareCard, options: ShareOptions, timing: ShareTiming) {
  if (isRace(card)) return []
  const all = highlights(card, options)
  if (!timing.length) return all
  return all.slice(0, Math.max(0, Math.floor((timing.length - timing.start - hold) / timing.step)))
}

function highlights(card: ShareCard, options: ShareOptions) {
  // The leaderboard and comparison have had their slides already.
  if (options.motion === "build" || card.chart.kind === "podium" || card.chart.kind === "versus") return []
  const chart = card.chart
  // A one-day chart goes along its bars, left to right; the whole range down its series in the legend's order.
  if (chart.kind === "stacked")
    return (chart.day !== undefined ? dayOrder(chart) : chart.series.map((_, index) => index)).filter(
      (series) => chart.series[series]?.key !== "other",
    )
  return chart.rows.map((_, index) => index)
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
      // The lit dots well clear of the grid, so the equaliser reads as it plays.
      ctx.globalAlpha = on ? 0.45 : fade
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
  // In step with the grid: wide bars (the 16:9 card) get bigger dots, so they hold their own beside the bars.
  const dot = Math.min(8, Math.max(3, Math.round(grid.pitch * 0.22)))
  const first = grid.center - Math.floor(grid.center / grid.pitch) * grid.pitch
  // A column that would start off the card's edge moves a whole pitch in, so every column stays on its bar's centre.
  const inset = first - dot / 2 < 0 ? first - dot / 2 + grid.pitch : first - dot / 2
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
  // One day: the grid the bars are laid on (dayLayout), a dot down the middle of the first bar.
  if (chart.day !== undefined) {
    const layout = dayLayout(dayOrder(chart).length, width - pad * 2)
    return { center: pad + layout.bar / 2, pitch: layout.pitch }
  }
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
  // The word close after the mark (16px at the corner size), so the two read as one lockup.
  spaced(ctx, kind === "full" ? "OPENCODE DATA" : "DATA", x + (40 + 16) * zoom, y + size / 2 + zoom, 34 * zoom * 0.08)
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
  const eyebrow = (options.layout === "chart" ? card.range : `${card.title} · ${card.range}`).toLocaleUpperCase(
    tag(card.locale),
  )
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
    // A sentence of its own under the number, so it starts with a capital.
    const caption = card.stat.label.charAt(0).toLocaleUpperCase(tag(card.locale)) + card.stat.label.slice(1)
    const lines = balance(ctx, caption, max).slice(0, 2)
    // A comma's tail hangs below the number, so the caption moves down to clear it.
    const tail = /[,;]/.test(card.stat.value) ? size * 0.18 : 0
    const first = y + gap + size * 0.8 + gap + tail
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
      // Right to left, the line's first part is set at its right end and the rest follow leftwards.
      const rtl = ctx.direction === "rtl"
      parts.reduce(
        (x, part, slot) => {
          const width = ctx.measureText(part).width
          ctx.fillStyle = parts.length === 3 && slot === 1 ? colors.highlight : colors.text
          ctx.fillText(part, rtl ? x - width : x, y + 56 + size * 0.8 + index * leading)
          return rtl ? x - width : x + width
        },
        rtl ? pad - 2 + ctx.measureText(line).width : pad - 2,
      )
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
    if (!/\d/.test(char)) return wheel
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
  // The rest (separators, units) don't turn, so they fade in outside the window: a comma's tail hangs below it.
  ctx.save()
  ctx.globalAlpha *= settle(time, 0.1, 0.5)
  chars.forEach((char, index) => {
    if (!/\d/.test(char)) ctx.fillText(char, x + index * advance, baseline)
  })
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
  if (chart.day !== undefined) return drawDay(ctx, chart, colors, box, progress, focus, litDots)
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

  // Each bar's segments, painted by paintSegments.
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
        // How far the bar has gone to the muted grey: "Other" always, the rest as another series takes the focus, and
        // every column but the card's own on a card about one day.
        const muted =
          chart.day !== undefined && chart.day !== index
            ? 1
            : series === focus.index
              ? 0
              : own === colors.other
                ? 1
                : focus.amount
        const rect = [x, state.y - size, width, Math.max(0, size - (size > 3 ? 1 : 0))] as const
        const color = series === focus.index ? spotlit(own, series, focus.amount, colors) : own
        return { y: state.y - size, parts: [...state.parts, { rect, color, muted }] }
      },
      { y: base, parts: [] },
    ).parts
  })
  paintSegments(ctx, segments, colors, litDots)

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

// A card about one day: that day alone, broken down, one bar per series, tallest first and Other last, each in its
// colour with its value over it. No names under the bars, which would truncate past reading; the legend names them. They rise one after another over the same dot grid; the
// highlights and the equaliser work on them as on the whole range's bars.
function drawDay(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "stacked" }>,
  colors: Palette,
  box: Box,
  progress: number,
  focus: Focus,
  litDots: (clip: Path2D) => void,
) {
  if (chart.style === "list") return drawDayList(ctx, chart, colors, box, progress, focus)
  if (chart.style === "dots") return drawDayDots(ctx, chart, colors, box, progress, focus)
  const values = chart.columns[chart.day ?? 0]?.values ?? []
  const order = dayOrder(chart)
  // Room over the bars for their values.
  const top = 64
  const plot = { ...box, y: box.y + top, height: box.height - axisHeight - top }
  const max = Math.max(0, ...order.map((series) => values[series] ?? 0)) || 1
  const layout = dayLayout(order.length, plot.width)
  const base = plot.y + plot.height
  const bars = order.map((series, position) => {
    const delay = (position / Math.max(1, order.length - 1)) * 0.5
    const grow = ease(Math.max(0, Math.min(1, (progress - delay) / 0.5)))
    const height = ((values[series] ?? 0) / max) * plot.height * grow
    const own = chart.series[series]?.color ?? colors.idle
    const muted = series === focus.index ? 0 : own === colors.other ? 1 : focus.amount
    const color = series === focus.index ? spotlit(own, series, focus.amount, colors) : own
    const rect = [plot.x + position * layout.step, base - height, layout.bar, height] as const
    return { series, grow, rect, color, muted }
  })
  paintSegments(ctx, bars, colors, litDots)

  ctx.fillStyle = colors.line
  ctx.fillRect(plot.x, base + 1, plot.width, 1)
  ctx.textBaseline = "alphabetic"
  bars.forEach((bar) => {
    if (bar.grow <= 0) return
    const item = chart.series[bar.series]
    const [x, y, width] = bar.rect
    const center = x + width / 2
    ctx.save()
    ctx.globalAlpha *= bar.grow
    // The value rides on the bar's top as it rises; the focused one in the text colour, the rest as the legend's.
    ctx.font = `${bar.series === focus.index && focus.amount > 0.5 ? 700 : 400} 26px ${font}`
    ctx.fillStyle = mix(colors.text, colors.muted, bar.series === focus.index ? 0 : Math.max(0.6, bar.muted))
    const value = item?.value ?? ""
    ctx.fillText(value, center - ctx.measureText(value).width / 2, y - 16)
    ctx.restore()
  })
}

// The race: the leading series as horizontal bars, each with its rank, name and share of the day over it, growing,
// shrinking and overtaking each other as the days run from the first to the last, the date ticking along large and faint
// behind them. Between days the values and the places ease, so an overtake is a smooth swap of rows; a series leaving
// the top six fades out as it drops. Every frame is the data of its moment.
function drawRace(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "stacked" }>,
  colors: Palette,
  box: Box,
  time: number,
  timing: ShareTiming,
  length: number,
) {
  const named = chart.series.map((_, index) => index).filter((index) => chart.series[index]?.key !== "other")
  const days = chart.columns.length
  if (days === 0 || named.length === 0) return
  const at = Math.max(0, Math.min(1, (time - timing.start) / length)) * (days - 1)
  const from = Math.floor(at)
  const to = Math.min(days - 1, from + 1)
  const step = at - from
  const swap = step * step * (3 - 2 * step)
  const value = (day: number, series: number) => chart.columns[day]?.values[series] ?? 0
  const total = (day: number) => chart.columns[day]?.values.reduce((sum, item) => sum + item, 0) ?? 0
  const now = (series: number) => value(from, series) + (value(to, series) - value(from, series)) * step
  const whole = total(from) + (total(to) - total(from)) * step
  const order = (day: number) => named.toSorted((a, b) => value(day, b) - value(day, a))
  const ranks = { from: order(from), to: order(to) }
  const rows = Math.min(6, named.length)
  // The clock and date set at the size of the card's subtitle, with room under the rows so they never meet.
  const dateSize = ctx.canvas.height <= 1080 ? 28 : 34
  const row = Math.min(150, (box.height - dateSize * 1.8) / rows)
  const top = box.y
  const max = Math.max(1e-9, ...named.map(now))
  // The bars grow in from nothing while the intro rises, before the days start to run.
  const grow = ease(Math.min(1, time / Math.max(0.01, timing.start)))
  const bar = Math.round(row * 0.72)
  // A third of the bar, but never under 26px (just below the subtitle) on the shorter cards, as far as the bar holds it.
  const size = Math.round(Math.max(bar * 0.34, Math.min(bar * 0.58, 26)))

  // The day, faint in the lower right; it counts on with the race.
  ctx.save()
  ctx.textBaseline = "alphabetic"
  ctx.font = `400 ${dateSize}px ${font}`
  ctx.fillStyle = colors.faint
  ctx.globalAlpha *= 0.6
  // A clock runs before the date, through each day as the race crosses it, so something is always moving; it marks
  // the race's place between two days, the data itself being daily.
  const minutes = Math.min(24 * 60 - 1, Math.floor(step * 24 * 60))
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
  const date = `${clock} ${chart.columns[from]?.label ?? ""}`
  ctx.fillText(date, box.x + box.width - ctx.measureText(date).width, box.y + box.height)
  ctx.restore()

  ctx.font = `400 ${size}px ${font}`
  const indent = ctx.measureText("00").width + size * 0.7
  named.forEach((series) => {
    const was = ranks.from.indexOf(series)
    const will = ranks.to.indexOf(series)
    const place = was + (will - was) * swap
    const shown = Math.max(0, Math.min(1, rows - place))
    if (shown <= 0) return
    const y = top + place * row + (row - bar) / 2
    const middle = y + bar / 2 + size * 0.36
    const item = chart.series[series]
    const color = item?.color ?? colors.idle
    const share = whole > 0 ? now(series) / whole : 0
    const span = box.width - indent
    const length = Math.max(bar * 0.12, (now(series) / max) * span * grow)
    ctx.save()
    ctx.globalAlpha *= shown
    ctx.textBaseline = "alphabetic"
    ctx.font = `400 ${size}px ${font}`
    ctx.fillStyle = colors.faint
    ctx.fillText(String(Math.round(place) + 1).padStart(2, "0"), box.x, middle)
    ctx.fillStyle = color
    ctx.fillRect(box.x + indent, y, Math.min(length, span), bar)
    // One line a row: the name and share inside the bar when it's long enough, otherwise just past its end.
    // The label stays put at the left of its row while the bar races under it: drawn in the text colour, then again,
    // clipped to the bar, in dark or white for contrast where the bar has reached. The shares are a little faded.
    const percent = `  ${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`
    const bold = `400 ${size}px ${font}`
    const regular = `400 ${size}px ${font}`
    const x = box.x + indent + size * 0.6
    ctx.font = regular
    const percentWidth = ctx.measureText(percent).width
    ctx.font = bold
    const name = truncate(ctx, item?.label ?? "", Math.max(0, box.x + box.width - x - percentWidth))
    const nameWidth = ctx.measureText(name).width
    const label = (fill: string, blend: GlobalCompositeOperation) => {
      ctx.fillStyle = fill
      ctx.font = bold
      ctx.fillText(name, x, middle)
      ctx.font = regular
      ctx.globalAlpha *= 0.6
      ctx.globalCompositeOperation = blend
      ctx.fillText(percent, x + nameWidth, middle)
      ctx.globalCompositeOperation = "source-over"
      ctx.globalAlpha /= 0.6
    }
    const end = box.x + indent + Math.min(length, span)
    ctx.save()
    ctx.beginPath()
    ctx.rect(end, y, box.x + box.width - end, bar)
    ctx.clip()
    label(colors.text, "source-over")
    ctx.restore()
    // On the bar the faded share blends into its colour (multiply under dark text, screen under white), so it reads
    // as a tone of the bar rather than grey.
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.x + indent, y, Math.min(length, span), bar)
    ctx.clip()
    const dark = luminance(color) > 0.5
    label(dark ? "#0c0c0c" : "#ffffff", dark ? "multiply" : "screen")
    ctx.restore()
    ctx.restore()
  })
}

// A colour's relative brightness (0 to 1), to set dark or white text on it.
function luminance(color: string) {
  const [r, g, b] = rgb(color)
  return (0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)) / 255
}

// A one-day chart as a ranked list: a row a series, most first and Other last, its name and value on one line and a
// bar under them, true to scale on a long axis, so the numbers carry the small ones. Rows rise and bars grow in turn.
function drawDayList(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "stacked" }>,
  colors: Palette,
  box: Box,
  progress: number,
  focus: Focus,
) {
  const values = chart.columns[chart.day ?? 0]?.values ?? []
  const order = dayOrder(chart)
  const max = Math.max(0, ...order.map((series) => values[series] ?? 0)) || 1
  const row = Math.min(96, box.height / Math.max(1, order.length))
  const size = Math.round(Math.min(30, row * 0.34))
  const bar = Math.max(6, Math.round(row * 0.16))
  ctx.save()
  ctx.textBaseline = "alphabetic"
  order.forEach((series, position) => {
    const y = box.y + position * row
    const delay = (position / Math.max(1, order.length - 1)) * 0.45
    const grow = ease(Math.max(0, Math.min(1, (progress - delay) / 0.55)))
    if (grow <= 0) return
    const item = chart.series[series]
    const muted = series === focus.index ? 0 : item?.key === "other" ? 1 : focus.amount
    ctx.globalAlpha = grow
    ctx.font = `${series === focus.index && focus.amount > 0.5 ? 700 : 400} ${size}px ${font}`
    ctx.fillStyle = mix(colors.text, colors.muted, muted * 0.6)
    const value = item?.value ?? ""
    const valueWidth = ctx.measureText(value).width
    ctx.fillText(truncate(ctx, item?.label ?? "", box.width - valueWidth - size), box.x, y + size)
    ctx.fillStyle = colors.muted
    ctx.fillText(value, box.x + box.width - valueWidth, y + size)
    const top = y + size + row * 0.18
    ctx.fillStyle = colors.line
    ctx.fillRect(box.x, top, box.width, bar)
    ctx.fillStyle = item?.key === "other" ? colors.other : (item?.color ?? colors.idle)
    ctx.globalAlpha = grow * (1 - muted * 0.6)
    ctx.fillRect(box.x, top, Math.max(2, ((values[series] ?? 0) / max) * box.width * grow), bar)
  })
  ctx.restore()
}

// A one-day chart as a dot matrix: two hundred square dots, each half a percent of the day, coloured by series in rank
// order (Other last), so even a sliver earns whole, countable dots. The dots fill in left to right, top to bottom.
function drawDayDots(
  ctx: CanvasRenderingContext2D,
  chart: Extract<ShareChart, { kind: "stacked" }>,
  colors: Palette,
  box: Box,
  progress: number,
  focus: Focus,
) {
  const values = chart.columns[chart.day ?? 0]?.values ?? []
  const order = dayOrder(chart)
  const total = order.reduce((sum, series) => sum + (values[series] ?? 0), 0) || 1
  const cells = 200
  // A grid that holds every dot exactly and fills the whole box: of the ways to split the dots into full rows, the
  // one whose dots come closest to square, each stretched to a rectangle to fill the rest.
  const squareness = (count: number) => Math.abs(Math.log((box.width * cells) / (box.height * count * count)))
  const columns = [4, 5, 8, 10, 20, 25, 40, 50].reduce((best, count) =>
    squareness(count) < squareness(best) ? count : best,
  )
  const rows = cells / columns
  const width = box.width / columns
  const height = box.height / rows
  // Each series' dots by largest remainder, so they add up to every dot; anything above zero earns at least one.
  const exact = order.map((series) => ((values[series] ?? 0) / total) * cells)
  const counts = exact.map((value) => (value > 0 ? Math.max(1, Math.floor(value)) : 0))
  const spare = cells - counts.reduce((sum, value) => sum + value, 0)
  exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .toSorted((a, b) => b.rest - a.rest)
    .slice(0, Math.max(0, spare))
    .forEach((entry) => (counts[entry.index] = (counts[entry.index] ?? 0) + 1))
  const owners = order.flatMap((series, index) => Array.from({ length: counts[index] ?? 0 }, () => series))
  const shown = Math.floor(ease(Math.min(1, progress)) * cells)
  const gap = Math.max(2, Math.min(width, height) * 0.22)
  ctx.save()
  for (let index = 0; index < cells; index++) {
    const x = box.x + (index % columns) * width
    const y = box.y + Math.floor(index / columns) * height
    const series = owners[index]
    const item = series === undefined ? undefined : chart.series[series]
    if (index >= shown || !item) {
      ctx.fillStyle = colors.line
    } else {
      const muted = series === focus.index ? 0 : item.key === "other" ? 1 : focus.amount
      ctx.fillStyle = item.key === "other" ? colors.other : mix(item.color, colors.idle, muted * 0.7)
    }
    ctx.fillRect(x + gap / 2, y + gap / 2, width - gap, height - gap)
  }
  ctx.restore()
}

// A one-day chart's bars on the dot grid, edge to edge across `width`: each an odd number of dot pitches wide round the
// dot at its middle, so its edges fall halfway between dot columns, with two or three pitches between them. Of those,
// the one whose pitch is nearest the whole range's, about 16px.
function dayLayout(count: number, width: number) {
  const bars = Math.max(1, count)
  const best = [2, 3]
    .flatMap((gap) => Array.from({ length: 16 }, (_, index) => ({ gap, dots: index * 2 + 3 })))
    .map((item) => ({ ...item, pitch: width / (bars * item.dots + (bars - 1) * item.gap) }))
    .toSorted((a, b) => Math.abs(a.pitch - 16) - Math.abs(b.pitch - 16))[0]!
  return { pitch: best.pitch, bar: best.dots * best.pitch, step: (best.dots + best.gap) * best.pitch }
}

// A one-day chart's bars: its series with anything that day, the most first and Other last.
function dayOrder(chart: Extract<ShareChart, { kind: "stacked" }>) {
  const values = chart.columns[chart.day ?? 0]?.values ?? []
  const other = (series: number) => (chart.series[series]?.key === "other" ? 1 : 0)
  return chart.series
    .map((_, series) => series)
    .filter((series) => (values[series] ?? 0) > 0)
    .toSorted((a, b) => other(a) - other(b) || (values[b] ?? 0) - (values[a] ?? 0))
}

// Bars and their segments, in three passes: under the muted ones the card's background, so the dot grid doesn't
// show through; then, with music, the equaliser's lit dots inside them; then every segment's colour, the muted grey
// as a translucent veil over those dots.
function paintSegments(
  ctx: CanvasRenderingContext2D,
  segments: Segment[],
  colors: Palette,
  litDots: (clip: Path2D) => void,
) {
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
// One of the opening slides: before the first cut the headline, large; then the leaderboard's places or the comparison's
// head to head and radar.
function drawSlide(
  ctx: CanvasRenderingContext2D,
  card: ShareCard,
  options: ShareOptions,
  colors: Palette,
  width: number,
  height: number,
  time: number,
  slides: { first: number; starts: number[] },
) {
  const chart = card.chart
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
  const index = slides.starts.findLastIndex((start) => time >= start)
  const since = index < 0 ? time : time - slides.starts[index]!
  ctx.textBaseline = "alphabetic"

  if (index < 0) {
    ctx.direction = dir(card.locale)
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
      spaced(ctx, `${card.title} · ${card.range}`.toLocaleUpperCase(tag(card.locale)), pad, top + 22, 28 * 0.12)
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
  if (chart.kind === "versus") {
    if (index === 0) drawHeadToHead(ctx, card.locale, chart, colors, box, width, since)
    if (index === 1) drawRadar(ctx, card.locale, chart, colors, box, since)
    return
  }
  const entry = chart.kind === "podium" ? chart.entries[index] : undefined
  if (!entry) return

  // Straight on the card, no tile: the logo large and faint at its right, the type punching in on the cut.
  const punch = 1 + 0.04 * (1 - settle(since, 0, 0.4))
  const dark = colors.background !== palettes.light.background
  const logo = shareLogo(entry.logo, dark)
  if (logo) {
    const size = Math.min(box.height * 0.95, box.width * 0.9)
    ctx.save()
    // Fainter than the type by far, and high in the space, clear of the number at the foot.
    ctx.globalAlpha = (dark ? 0.05 : 0.045) * settle(since, 0, 0.5)
    ctx.drawImage(logo, width - size * 0.72, box.y - size * 0.12, size, size)
    ctx.restore()
  }
  ctx.save()
  ctx.translate(box.x + box.width / 2, box.y + box.height / 2)
  ctx.scale(punch, punch)
  ctx.translate(-(box.x + box.width / 2), -(box.y + box.height / 2))
  // Bottom up: the change beside the tokens on their baseline (under them when there's no room), the tokens' caption
  // over them, the provider with its logo, the name; the place large and faint in the top corner.
  const inset = 0
  const left = box.x
  const room = box.width
  const bottom = box.y + box.height
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
  // Room under the name for its descenders before the provider.
  const nameY = providerY - 40 - 56
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
    spaced(
      ctx,
      `${translate(card.locale, "share.card.tokens")} · ${card.range}`.toLocaleUpperCase(tag(card.locale)),
      left,
      captionY,
      24 * 0.14,
    )
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
  // Side by side only on the wide card; stacked, every name has the full width.
  const across = ctx.canvas.width > ctx.canvas.height
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
      ctx.globalAlpha = amount * (dark ? 0.05 : 0.045)
      ctx.drawImage(logo, x + tile.width - size * 0.78, y + (tile.height - size) / 2, size, size)
      ctx.globalAlpha = amount
    }
    // A short tile (under the big number) sets in one row: the place, then the name over the provider, then the tokens
    // over the change on the right, all centred. A taller one puts the place in its corner and the rest at its foot.
    const row = !across && tile.height < 180
    const inset = across ? 32 : 36
    const size = across ? 34 : row ? 28 : Math.min(44, tile.height * 0.19)
    const small = Math.round(size * 0.72)
    ctx.textBaseline = "alphabetic"
    ctx.font = `400 ${row ? size : small}px ${font}`
    ctx.fillStyle = colors.faint
    const placeWidth = ctx.measureText(entry.place).width
    ctx.fillText(entry.place, x + inset, row ? y + tile.height / 2 + size * 0.36 : y + inset + small * 0.8)
    const start = row ? x + inset + placeWidth + 32 : x + inset
    // The name and provider at the foot on the left; the tokens and change at the foot on the right.
    const foot = row ? y + tile.height / 2 + size * 0.36 + small * 0.75 : y + tile.height - inset
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
    ctx.fillText(truncate(ctx, entry.provider, right - change - 24 - start), start, foot)
    ctx.font = `700 ${size}px ${font}`
    ctx.fillStyle = mix(colors.text, colors.faint, dim)
    ctx.fillText(truncate(ctx, entry.label, right - value - 24 - start), start, foot - size * 1.25)
    ctx.restore()
  })
}

// The comparison's first slide: the two models facing each other, each over its logo, large and faint, in its own half,
// a big "vs" between them.
function drawHeadToHead(
  ctx: CanvasRenderingContext2D,
  locale: Locale,
  chart: Extract<ShareChart, { kind: "versus" }>,
  colors: Palette,
  box: Box,
  width: number,
  since: number,
) {
  const dark = colors.background !== palettes.light.background
  // Side by side on the wide card; one over the other otherwise, so each name has the full width.
  const across = ctx.canvas.width > ctx.canvas.height
  const middle = across ? box.x + box.width / 2 : box.y + box.height / 2
  chart.models.forEach((model, side) => {
    const area = across
      ? { x: side === 0 ? box.x : middle + 60, y: box.y, width: box.width / 2 - 60, height: box.height }
      : { x: box.x, y: side === 0 ? box.y : middle + 50, width: box.width, height: box.height / 2 - 50 }
    const logo = shareLogo(model.logo, dark)
    if (logo) {
      const size = Math.min(area.height * 1.05, area.width * 0.9)
      ctx.save()
      ctx.beginPath()
      ctx.rect(
        across ? (side === 0 ? 0 : middle) : 0,
        across ? 0 : side === 0 ? 0 : middle,
        across ? width / 2 : width,
        across ? ctx.canvas.height : side === 0 ? middle : ctx.canvas.height - middle,
      )
      ctx.clip()
      ctx.globalAlpha = (dark ? 0.08 : 0.07) * settle(since, side * 0.15, 0.5)
      ctx.drawImage(logo, area.x + area.width - size * 0.75, area.y + (area.height - size) / 2, size, size)
      ctx.restore()
    }
    const name = Math.min(72, fit(ctx, model.label, area.width - 56, 72, 700))
    const foot = area.y + area.height / 2 + name * 0.4
    // The name in the text colour, after a square in the model's colour: the legend for the radar that follows.
    const swatch = Math.round(name * 0.42)
    const indent = swatch + Math.round(name * 0.36)
    rise(ctx, since, 0.1 + side * 0.15, foot, name, () => {
      ctx.fillStyle = side === 0 ? colors.first : colors.second
      ctx.fillRect(area.x, foot - name * 0.36 - swatch / 2, swatch, swatch)
      ctx.font = `700 ${name}px ${font}`
      ctx.fillStyle = colors.text
      ctx.fillText(model.label, area.x + indent - 2, foot)
    })
    rise(ctx, since, 0.18 + side * 0.15, foot + 56, 36, () => {
      ctx.font = `400 36px ${font}`
      ctx.fillStyle = colors.muted
      ctx.fillText(model.provider, area.x + indent, foot + 56)
    })
  })
  rise(ctx, since, 0.3, across ? box.y + box.height / 2 + 28 : middle + 28, 80, () => {
    ctx.font = `400 80px ${font}`
    ctx.fillStyle = colors.faint
    const versus = translate(locale, "share.card.versus")
    const x = across ? middle - ctx.measureText(versus).width / 2 : box.x
    ctx.fillText(versus, x, across ? box.y + box.height / 2 + 28 : middle + 28)
  })
}

// The comparison's second slide: a radar of every measure, each model's shape in its colour, growing out from the
// middle; each axis named at its tip with both values under the name.
function drawRadar(
  ctx: CanvasRenderingContext2D,
  locale: Locale,
  chart: Extract<ShareChart, { kind: "versus" }>,
  colors: Palette,
  box: Box,
  since: number,
) {
  const count = chart.rows.length
  if (count < 3) return
  const legend = 48
  const cx = box.x + box.width / 2
  const cy = box.y + legend + (box.height - legend) / 2
  const radius = Math.min(box.width / 2 - 150, (box.height - legend) / 2 - 90)
  const point = (index: number, amount: number) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
    return { x: cx + Math.cos(angle) * radius * amount, y: cy + Math.sin(angle) * radius * amount }
  }
  // The legend: each model's swatch and name.
  ctx.font = `700 28px ${font}`
  chart.models.reduce((x, model, side) => {
    ctx.globalAlpha = settle(since, 0.05 + side * 0.08, 0.5)
    ctx.fillStyle = side === 0 ? colors.first : colors.second
    ctx.fillRect(x, box.y + 4, 20, 20)
    ctx.fillStyle = colors.text
    ctx.fillText(model.label, x + 32, box.y + 23)
    return x + 32 + ctx.measureText(model.label).width + 48
  }, box.x)
  ctx.globalAlpha = 1
  // The web: four rings and a spoke an axis.
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 2
  ;[0.25, 0.5, 0.75, 1].forEach((ring) => {
    ctx.beginPath()
    Array.from({ length: count }, (_, index) => point(index, ring)).forEach((p, index) =>
      index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
    )
    ctx.closePath()
    ctx.stroke()
  })
  Array.from({ length: count }, (_, index) => point(index, 1)).forEach((p) => {
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  })
  // Each model's shape, the second under the first.
  ;[1, 0].forEach((side) => {
    const grow = ease(Math.min(1, Math.max(0, (since - 0.2 - side * 0.1) / 0.7)))
    if (grow <= 0) return
    const color = side === 0 ? colors.first : colors.second
    const points = chart.rows.map((row, index) => point(index, Math.max(0.04, row.scores[side] ?? 0) * grow))
    ctx.beginPath()
    points.forEach((p, index) => (index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.globalAlpha = 0.16
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = 4
    ctx.stroke()
    points.forEach((p) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    })
  })
  // The axes' names and values, out past each tip.
  chart.rows.forEach((row, index) => {
    const tip = point(index, 1)
    const dx = tip.x - cx
    const dy = tip.y - cy
    const align: CanvasTextAlign = Math.abs(dx) < 4 ? "center" : dx > 0 ? "left" : "right"
    const x = tip.x + Math.sign(Math.round(dx)) * 24
    const y = tip.y + (Math.abs(dy) < 4 ? -14 : dy > 0 ? 40 : -44)
    ctx.save()
    ctx.globalAlpha = settle(since, 0.4 + index * 0.05, 0.5)
    ctx.textAlign = align
    ctx.font = `400 20px ${font}`
    ctx.fillStyle = colors.faint
    ctx.fillText(row.label.toLocaleUpperCase(tag(locale)), x, y)
    ctx.font = `700 26px ${font}`
    const [a, b] = row.values
    const gap = "  "
    const total = ctx.measureText(`${a}${gap}${b}`).width
    const start = align === "left" ? x : align === "right" ? x - total : x - total / 2
    ctx.textAlign = "left"
    ctx.fillStyle = colors.first
    ctx.fillText(a ?? "", start, y + 34)
    ctx.fillStyle = colors.second
    ctx.fillText(b ?? "", start + ctx.measureText(`${a}${gap}`).width, y + 34)
    ctx.restore()
  })
}

// Two models head to head: their names over their logos, large and faint, one each side; then a row a metric, its
// name in the middle and each model's bar growing out from it, the one the metric favours in colour.
function drawVersus(
  ctx: CanvasRenderingContext2D,
  locale: Locale,
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
  // The names scale with the room the header has, so their providers stay above the rows.
  const name = Math.min(
    40,
    head * 0.3,
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
  const versus = translate(locale, "share.card.versus")
  ctx.fillText(versus, middle - ctx.measureText(versus).width / 2, box.y + head * 0.5)
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
    // Sized to the row: on a short card (under a big number) the type and bar shrink so each row keeps to its own.
    const scale = Math.min(1, row / 84)
    const caption = Math.round(22 * scale)
    const figure = Math.round(30 * scale)
    const baseline = y + figure
    // Clear air between the figures and their bars.
    const bar = baseline + Math.max(14, row * 0.22)
    const thick = Math.max(5, Math.round(10 * scale))
    ctx.font = `400 ${caption}px ${font}`
    ctx.fillStyle = mix(colors.faint, colors.mark, dim)
    const label = item.label.toLocaleUpperCase(tag(locale))
    spaced(ctx, label, middle - (ctx.measureText(label).width + label.length * 2) / 2, baseline, 2)
    const reach = half - 8
    item.values.forEach((value, side) => {
      const lead = item.lead === side
      const fill = Math.max(0.02, Math.min(1, item.fills[side] ?? 0)) * reach * grow
      ctx.fillStyle = colors.track
      ctx.fillRect(side === 0 ? middle - 4 - reach : middle + 4, bar, reach, thick)
      ctx.fillStyle = mix(lead ? (side === 0 ? colors.first : colors.second) : colors.idle, colors.idle, dim)
      ctx.fillRect(side === 0 ? middle - 4 - fill : middle + 4, bar, fill, thick)
      ctx.font = `${lead ? 700 : 400} ${figure}px ${font}`
      ctx.fillStyle = mix(lead ? colors.text : colors.muted, colors.faint, dim)
      ctx.fillText(value, side === 0 ? box.x : box.x + box.width - ctx.measureText(value).width, baseline)
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
  const label = footerDate(card)
  if (!label) return
  ctx.font = `400 30px ${font}`
  ctx.fillStyle = colors.faint
  ctx.fillText(label, width - pad - ctx.measureText(label).width, y)
}

// The footer's date: on a card about one day, that day (or its week), as the eyebrow and the editor's Date say;
// otherwise when the data was updated.
function footerDate(card: ShareCard) {
  const chart = card.chart
  const column = chart.kind === "stacked" && chart.day !== undefined ? chart.columns[chart.day] : undefined
  if (chart.kind === "stacked" && column?.start) {
    const starts = chart.columns.map((item) => Date.parse(`${item.start}T00:00:00Z`))
    const weekly = (starts[1] ?? 0) - (starts[0] ?? 0) >= 6 * 86_400_000
    const date = formatUpdated(card.locale, `${column.start}T00:00:00Z`)
    return weekly ? translate(card.locale, "share.range.weekOf", { date }) : date
  }
  return card.updatedAt
    ? translate(card.locale, "share.card.updated", { date: formatUpdated(card.locale, card.updatedAt) })
    : undefined
}

function formatUpdated(locale: Locale, value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(tag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

// Draws text with tracking one character at a time, since canvas letterSpacing isn't in every browser. Scripts whose
// letters join or stack (Hebrew, Arabic, Thai) only shape when drawn whole, so they go untracked.
function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  if (/[\u0590-\u08ff\u0e00-\u0e7f\ufb1d-\ufefc]/.test(text)) return ctx.fillText(text, x, y)
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

// Lines break at spaces and, in scripts written without them (Chinese, Japanese, Thai), between the words
// Intl.Segmenter finds, punctuation staying with the word before it.
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const pieces = text.split(/\s+/).flatMap((word) => {
    if (!unspaced.test(word)) return [{ text: word, space: true }]
    return [...words.segment(word)].reduce<{ text: string; space: boolean }[]>((all, part, index) => {
      const last = all.at(-1)
      if (last && !part.isWordLike) return [...all.slice(0, -1), { ...last, text: last.text + part.segment }]
      return [...all, { text: part.segment, space: index === 0 }]
    }, [])
  })
  return pieces.reduce<string[]>((lines, piece) => {
    const last = lines.at(-1)
    const joined = `${last}${piece.space ? " " : ""}${piece.text}`
    if (last !== undefined && ctx.measureText(joined).width <= max) return [...lines.slice(0, -1), joined]
    return [...lines, piece.text]
  }, [])
}

const unspaced =
  /[\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/
const words = new Intl.Segmenter(undefined, { granularity: "word" })

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
