/*
 * Generative cover patterns for the printed legal documents.
 *
 * Pure and deterministic: the same params (including `seed`) always produce the same SVG. No DOM,
 * no imports, so it can move into packages/console/app/src/lib/legal/ unchanged. All lengths are
 * millimetres on an A4 sheet (210 × 297); the output is black on white (or white on black when
 * inverted), with no grey, so it prints with "background graphics" off.
 */

export const primitives = ["dots", "squares", "lines", "crosses", "circles", "arcs"] as const
export const layouts = ["grid", "radial", "spiral", "rings", "phyllotaxis"] as const
export const axes = ["row", "column", "diagonal", "distance", "angle", "index", "noise"] as const
export const orients = ["fixed", "tangent", "radial"] as const

/** Where an emitter's elements come from: a point of the logo, its outline, or the mark's own cells. */
export const emitOrigins = ["centre", "top-left", "bottom-right", "outline", "cells"] as const
export const distributions = ["rays", "ripples", "spiral", "fan", "flow", "warpgrid", "echoes"] as const
export const eases = ["linear", "ease", "in", "out", "exp", "step"] as const
/** Shape sequences an emitter morphs through between `morphFrom` and `morphTo`. */
export const morphs = [
  "none",
  "dot-square-cross-line",
  "dot-square",
  "dot-cross",
  "dot-circle-square",
  "square-cross-line",
  "dot-line",
] as const

export type Primitive = (typeof primitives)[number]
export type Layout = (typeof layouts)[number]
export type Axis = (typeof axes)[number]
export type Orient = (typeof orients)[number]
export type EmitOrigin = (typeof emitOrigins)[number]
export type Distribution = (typeof distributions)[number]
export type Ease = (typeof eases)[number]
export type Morph = (typeof morphs)[number]
export type Box = { x: number; y: number; w: number; h: number }
export const logoFits = ["none", "size", "pixel", "pitch"] as const
export type LogoFit = (typeof logoFits)[number]

export type PatternParams = {
  version: 1
  /** "pattern" fills the field with a layout; "emitter" radiates elements out of the cover logo. */
  mode: "pattern" | "emitter"
  emitFrom: EmitOrigin
  distribution: Distribution
  /** Rays and flow streams from several seeds: across the sweep, or straight out from the logo. */
  aim: "sweep" | "outward"
  /** Rays, spiral arms or flow streams per seed. */
  arms: number
  /** Fan points per seed. */
  points: number
  /** The fan of directions, in degrees (0 = right, 90 = down). */
  sweepFrom: number
  sweepTo: number
  /** The distance, in mm, over which size, rotation, morph and waves run from start to end. */
  reach: number
  /** How much the spacing has grown at `reach`: 1 = even, 2 = twice as wide. */
  growth: number
  /** Spiral and warped-grid twist, in degrees per mm of distance. */
  curl: number
  /** Flow streams' S-bend, in degrees. */
  bend: number
  sizeFrom: number
  sizeTo: number
  sizeEase: Ease
  rotFrom: number
  rotTo: number
  rotEase: Ease
  /** The number of steps for the "step" ease. */
  easeSteps: number
  morph: Morph
  morphFrom: number
  morphTo: number
  /** Emitter lines: length as a multiple of the size. */
  lineRatio: number
  /** 0–1: the share of elements left out at `reach`, rising from none at the logo. */
  densityFalloff: number
  /** 0–1: every other ray, ring or echo is offset by this share of half a step. */
  stagger: number
  /** Size waves across `reach`, their phase (0–1) and depth (0–1). */
  waves: number
  wavePhase: number
  waveAmp: number
  /** 0–1: how much of the jitter is held back near the logo and released with distance. */
  jitterGrowth: number
  /** Stop at `reach`, in an arc around the logo, instead of at the field's edge. */
  cutoffArc: boolean
  /** A rounded clear zone around the logo, in mm. */
  clearRadius: number
  /** 0–1: how far out the emitter has grown, as a share of `reach` (1 = all of it). */
  grow: number
  primitive: Primitive
  /** Squares only: solid or outlined. Dots are always solid, circles and arcs always outlined. */
  fill: "solid" | "outline"
  layout: Layout
  /**
   * What `count` means depends on the layout: grid columns, radial spokes, spiral points, rings,
   * or phyllotaxis points.
   */
  count: number
  /** Distance between neighbouring elements, in mm (phyllotaxis: the growth constant). */
  spacing: number
  /** Element size (dots, squares, circles, arcs), in mm. */
  size: number
  /** Line and cross length, in mm. */
  length: number
  /** Stroke weight, in mm. Never below `minimum`. */
  weight: number
  /** Concentric copies of each outlined square, circle or arc. */
  nest: number
  /** Incremental rotation, in degrees per step of `axis`. */
  rotation: number
  axis: Axis
  /** The base orientation before the incremental rotation: fixed, along the circle, or pointing out. */
  orient: Orient
  /** Rotation added to every element, in degrees. */
  offset: number
  /** Round every rotation to a multiple of this, in degrees (0 = off). */
  snap: number
  /** Scale falloff from the centre to the edge: 0.5 halves the outer elements, −0.5 grows them. */
  falloff: number
  /** The arc's span, in degrees. */
  arc: number
  /** A second, transformed copy of the layer, for moiré. */
  layer2: boolean
  layer2Angle: number
  layer2Scale: number
  layer2ShiftX: number
  layer2ShiftY: number
  /** Sine warp of the field: vertical displacement in mm and cycles across the field. */
  warpAmp: number
  warpFreq: number
  warpPhase: number
  seed: number
  /** 0–1: random displacement (of the spacing), rotation (of 90°) and square corners. */
  jitter: number
  /** 0–1: the share of elements left out at random. */
  dropout: number
  /** The size of a noise feature, in mm (axis "noise"). */
  noiseScale: number
  clip: "rect" | "circle"
  /** Inset of the clip shape from the field's edges, in mm. */
  margin: number
  /** The pattern's centre, as a fraction of the field. */
  cx: number
  cy: number
  invert: boolean
  /** Where the field sits on the A4 cover, in mm. */
  field: Box
  /** Clear space around the cover logo, in mm (0 = draw under it). */
  clearLogo: number
  /**
   * "text" frames the field on the cover text's left edge: x = `textX`, the same inset on the right
   * and top, the bottom kept; a grid then starts with its first square's edge on the field's left
   * and top edges (ignoring `cx`/`cy`). "free" uses `field` as given.
   */
  align: "free" | "text"
  /**
   * Empty a grid-snapped block for the logo: every element whose centre falls inside the logo's box,
   * widened right and down to the next grid line of `spacing` (counted from the field's top-left)
   * plus `clearSteps` more grid steps.
   */
  clearBlock: boolean
  clearSteps: number
  /**
   * How the logo meets an aligned grid, so the gap to the nearest column on its right equals the gap
   * to the nearest row below it: "none" keeps the 10 × 12.5mm logo; "size" picks the 10–13mm width
   * whose gaps come closest; "pixel" makes one cell of the 4 × 5 mark one grid step; "pitch" makes
   * the grid step one cell of the 10 × 12.5mm mark (2.5mm). Pattern mode only.
   */
  logoFit: LogoFit
  /**
   * Aligned grids only: stretch the pitch slightly so a whole number of steps spans the field, putting
   * the outer edges of the first and last squares exactly on the field's left and right edges.
   */
  fitSpan: boolean
}

/** The smallest printed feature, in mm: no dot, square, line length or stroke goes below it. */
export const minimum = 0.2
/** The cover logo's box, in mm on the A4 sheet. */
export const logo: Box = { x: 15, y: 15, w: 10, h: 12.5 }
/** The cover title's top, in mm: the field stops above it. */
export const titleTop = 197
/**
 * The site's architect cover, in mm on A4 from the top-left corner. The label and title form one
 * group with about 16mm above it (from the c3 grid's last row at 189.3125mm) and below it (to the
 * form's top at 238.315mm).
 */
export const cover = {
  logo,
  title: { x: 15, y: titleTop, w: 150, h: 28 },
  /** Inter 34pt, weight 500, line-height 1, −0.03em. */
  titleSize: 34,
  titleBaseline: 222.25,
  /** "OpenCode legal": OpenTUI Mono 8pt × 1.05, 11px (2.910mm) above the title. */
  labelSize: 8,
  labelCapTop: 205.359,
  form: { x: 15, y: 240, w: 90, h: 42 },
  formSize: 8,
  formTop: 238.315,
  firstRule: 244.665,
  row: 6.35,
  labelColumn: 22,
  rule: 0.2125,
}
/** The clear space kept between any field's bottom and the label's cap top, in mm. */
export const labelClear = 16
/** The lowest a field may reach, in mm: 16mm above the label's caps (189.359mm). */
export const fieldBottomMax = cover.labelCapTop - labelClear
/** The left edge of the cover's logo, title, label and form block, in mm. */
export const textX = 15
/** The most elements one render draws; denser settings are cut off. */
export const maxElements = 40000

export const defaults: PatternParams = {
  version: 1,
  mode: "pattern",
  emitFrom: "bottom-right",
  distribution: "ripples",
  aim: "sweep",
  arms: 16,
  points: 2000,
  sweepFrom: 0,
  sweepTo: 90,
  reach: 240,
  growth: 1.5,
  curl: 0.5,
  bend: 30,
  sizeFrom: 0.3,
  sizeTo: 2.4,
  sizeEase: "out",
  rotFrom: 0,
  rotTo: 90,
  rotEase: "linear",
  easeSteps: 5,
  morph: "none",
  morphFrom: 0.15,
  morphTo: 0.9,
  lineRatio: 1.6,
  densityFalloff: 0,
  stagger: 0,
  waves: 3,
  wavePhase: 0,
  waveAmp: 0,
  jitterGrowth: 0,
  cutoffArc: false,
  clearRadius: 0,
  grow: 1,
  primitive: "squares",
  fill: "solid",
  layout: "grid",
  count: 60,
  spacing: 4,
  size: 0.425,
  length: 3,
  weight: 0.25,
  nest: 1,
  rotation: 0,
  axis: "row",
  orient: "fixed",
  offset: 0,
  snap: 0,
  falloff: 0,
  arc: 90,
  layer2: false,
  layer2Angle: 5,
  layer2Scale: 1,
  layer2ShiftX: 0,
  layer2ShiftY: 0,
  warpAmp: 0,
  warpFreq: 1,
  warpPhase: 0,
  seed: 1,
  jitter: 0,
  dropout: 0,
  noiseScale: 40,
  clip: "rect",
  margin: 0,
  cx: 0.5,
  cy: 0.5,
  invert: false,
  field: { x: 0, y: 0, w: 210, h: 189.3 },
  clearLogo: 0,
  align: "free",
  clearBlock: false,
  clearSteps: 1,
  logoFit: "none",
  fitSpan: false,
}

const preset = (name: string, params: Partial<PatternParams>) => ({ name, params: { ...defaults, ...params } })

export const presets = [
  // The site's c3 grid: 53 × 48 squares, the outer ones 0.8875mm from the sheet's sides and top, the last row ending at 189.3125mm.
  preset("OpenCode grid", { field: { x: 0, y: 0, w: 210.2, h: 189.3125 }, count: 53, cy: 93.1 / 189.3125 }),
  preset("Aligned grid", {
    align: "text",
    // Its last row on the fitted 2.494mm pitch ends at 187.518mm, the last one above 189.3mm.
    field: { x: textX, y: textX, w: 210 - 2 * textX, h: 189.3 - textX },
    clearLogo: 1.5,
    logoFit: "pitch",
    fitSpan: true,
  }),
  preset("Molnár squares", {
    fill: "outline",
    spacing: 12,
    size: 10,
    nest: 5,
    weight: 0.25,
    rotation: 1.5,
    axis: "row",
    jitter: 0.35,
    margin: 15,
    clearLogo: 4,
    seed: 7,
  }),
  preset("Rotating ticks", {
    primitive: "lines",
    spacing: 5,
    length: 4,
    weight: 0.3,
    rotation: 9,
    axis: "distance",
    margin: 15,
    clearLogo: 4,
  }),
  preset("Moiré grids", {
    primitive: "lines",
    spacing: 1.6,
    length: 1.6,
    weight: 0.3,
    count: 200,
    layer2: true,
    layer2Angle: 4,
    clip: "circle",
    margin: 25,
  }),
  preset("Phyllotaxis dots", {
    primitive: "dots",
    layout: "phyllotaxis",
    count: 1600,
    spacing: 2.2,
    size: 1.7,
    falloff: 0.75,
    clip: "circle",
    margin: 15,
  }),
  preset("Concentric rings", {
    primitive: "dots",
    layout: "rings",
    count: 34,
    spacing: 2.6,
    size: 0.9,
    falloff: 0.5,
    clip: "circle",
    margin: 12,
  }),
  preset("Sine field", {
    primitive: "lines",
    spacing: 2.4,
    length: 2.4,
    weight: 0.3,
    count: 120,
    warpAmp: 7,
    warpFreq: 1.5,
    margin: 15,
    clearLogo: 4,
  }),
  preset("Spiral lines", {
    primitive: "lines",
    layout: "spiral",
    orient: "radial",
    count: 1400,
    spacing: 2.8,
    length: 2.4,
    weight: 0.3,
    rotation: 0.25,
    axis: "index",
    clip: "circle",
    margin: 12,
  }),
  preset("Interference", {
    primitive: "lines",
    layout: "rings",
    orient: "tangent",
    count: 48,
    spacing: 2.2,
    length: 2.2,
    weight: 0.3,
    layer2: true,
    layer2Angle: 0,
    layer2ShiftX: 14,
    layer2ShiftY: 6,
    clip: "circle",
    margin: 10,
  }),
  preset("Turning crosses", {
    primitive: "crosses",
    spacing: 7,
    length: 5,
    weight: 0.3,
    rotation: 3.6,
    axis: "diagonal",
    margin: 15,
    clearLogo: 4,
  }),
]

const emitter = (name: string, params: Partial<PatternParams>) =>
  preset(name, {
    mode: "emitter",
    primitive: "dots",
    field: { x: 0, y: 0, w: 210.2, h: 189.3 },
    clearRadius: 3,
    ...params,
  })

/** Presets for the emitter: elements radiate out of the cover logo, turning and growing as they go. */
export const emitterPresets = [
  emitter("Ripple", {
    distribution: "ripples",
    emitFrom: "bottom-right",
    spacing: 3.6,
    growth: 2,
    sizeFrom: 0.3,
    sizeTo: 2.2,
    sizeEase: "out",
    stagger: 1,
  }),
  emitter("Unfold", {
    distribution: "rays",
    emitFrom: "bottom-right",
    arms: 22,
    spacing: 4.5,
    growth: 1.9,
    morph: "dot-square-cross-line",
    morphFrom: 0.08,
    morphTo: 0.85,
    sizeFrom: 0.4,
    sizeTo: 5,
    sizeEase: "in",
    rotFrom: 0,
    rotTo: 135,
    rotEase: "ease",
    orient: "radial",
    stagger: 1,
    weight: 0.3,
    lineRatio: 1.4,
  }),
  emitter("Echoes", {
    distribution: "echoes",
    emitFrom: "centre",
    sweepFrom: 0,
    sweepTo: 360,
    primitive: "squares",
    spacing: 4.2,
    growth: 1.7,
    sizeFrom: 0.3,
    sizeTo: 1.9,
    sizeEase: "linear",
    rotFrom: 0,
    rotTo: 45,
    clearRadius: 2,
  }),
  emitter("Spiral arms", {
    distribution: "spiral",
    emitFrom: "centre",
    arms: 28,
    sweepFrom: 0,
    sweepTo: 360,
    curl: 0.8,
    spacing: 2.6,
    growth: 1.25,
    sizeFrom: 0.3,
    sizeTo: 3,
    sizeEase: "in",
  }),
  emitter("Pixel bloom", {
    distribution: "ripples",
    emitFrom: "cells",
    sweepFrom: -20,
    sweepTo: 110,
    primitive: "squares",
    spacing: 11,
    growth: 1.3,
    sizeFrom: 0.3,
    sizeTo: 1.6,
    densityFalloff: 0.2,
    reach: 260,
    seed: 3,
  }),
  emitter("Fan", {
    distribution: "fan",
    emitFrom: "bottom-right",
    primitive: "squares",
    points: 2600,
    spacing: 3,
    growth: 1.4,
    sizeFrom: 0.3,
    sizeTo: 2.6,
    sizeEase: "in",
    rotFrom: 0,
    rotTo: 90,
    orient: "radial",
  }),
  emitter("Warped grid", {
    distribution: "warpgrid",
    emitFrom: "top-left",
    primitive: "squares",
    spacing: 4.2,
    growth: 2.2,
    curl: 0.12,
    sizeFrom: 0.4,
    sizeTo: 3,
    rotFrom: 0,
    rotTo: 60,
    rotEase: "out",
    orient: "radial",
  }),
  emitter("Shockwave", {
    distribution: "ripples",
    emitFrom: "outline",
    sweepFrom: 0,
    sweepTo: 360,
    spacing: 2.5,
    growth: 1.4,
    sizeFrom: 0.25,
    sizeTo: 1.7,
    waves: 4,
    waveAmp: 1,
    stagger: 1,
  }),
]

/** Fills in missing params from the defaults and clamps everything to printable, finite values. */
export function normalize(input: Partial<PatternParams>): PatternParams {
  const p = { ...defaults, ...input, field: { ...defaults.field, ...input.field } }
  const pick = <T extends string>(value: T, options: readonly T[], fallback: T) =>
    options.includes(value) ? value : fallback
  const num = (value: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback
  return {
    ...p,
    version: 1,
    primitive: pick(p.primitive, primitives, defaults.primitive),
    fill: p.fill === "outline" ? "outline" : "solid",
    layout: pick(p.layout, layouts, defaults.layout),
    axis: pick(p.axis, axes, defaults.axis),
    orient: pick(p.orient, orients, defaults.orient),
    clip: p.clip === "circle" ? "circle" : "rect",
    count: Math.round(num(p.count, 1, 5000, defaults.count)),
    spacing: num(p.spacing, 0.5, 60, defaults.spacing),
    size: num(p.size, minimum, 60, defaults.size),
    length: num(p.length, minimum, 80, defaults.length),
    weight: num(p.weight, minimum, 3, defaults.weight),
    nest: Math.round(num(p.nest, 1, 12, 1)),
    seed: Math.round(num(p.seed, 0, 1e9, 1)),
    jitter: num(p.jitter, 0, 1, 0),
    dropout: num(p.dropout, 0, 1, 0),
    noiseScale: num(p.noiseScale, 2, 400, defaults.noiseScale),
    layer2Scale: num(p.layer2Scale, 0.5, 2, 1),
    margin: p.align === "text" ? 0 : num(p.margin, 0, 80, 0),
    cx: num(p.cx, 0, 1, 0.5),
    cy: num(p.cy, 0, 1, 0.5),
    clearLogo: num(p.clearLogo, 0, 30, 0),
    align: p.align === "text" ? "text" : "free",
    clearBlock: Boolean(p.clearBlock),
    clearSteps: Math.round(num(p.clearSteps, 0, 2, 1)),
    logoFit: pick(p.logoFit, logoFits, "none"),
    fitSpan: Boolean(p.fitSpan),
    mode: p.mode === "emitter" ? "emitter" : "pattern",
    emitFrom: pick(p.emitFrom, emitOrigins, defaults.emitFrom),
    distribution: pick(p.distribution, distributions, defaults.distribution),
    aim: p.aim === "outward" ? "outward" : "sweep",
    sizeEase: pick(p.sizeEase, eases, defaults.sizeEase),
    rotEase: pick(p.rotEase, eases, defaults.rotEase),
    morph: pick(p.morph, morphs, defaults.morph),
    arms: Math.round(num(p.arms, 1, 360, defaults.arms)),
    points: Math.round(num(p.points, 10, 20000, defaults.points)),
    reach: num(p.reach, 20, 400, defaults.reach),
    growth: num(p.growth, 0.25, 5, 1),
    sizeFrom: num(p.sizeFrom, 0, 30, defaults.sizeFrom),
    sizeTo: num(p.sizeTo, 0, 30, defaults.sizeTo),
    easeSteps: Math.round(num(p.easeSteps, 2, 24, defaults.easeSteps)),
    morphFrom: num(p.morphFrom, 0, 1, defaults.morphFrom),
    morphTo: num(p.morphTo, 0, 1, defaults.morphTo),
    lineRatio: num(p.lineRatio, 0.5, 10, defaults.lineRatio),
    densityFalloff: num(p.densityFalloff, 0, 1, 0),
    stagger: num(p.stagger, 0, 1, 0),
    waves: num(p.waves, 0, 40, defaults.waves),
    wavePhase: num(p.wavePhase, -10, 10, 0),
    waveAmp: num(p.waveAmp, 0, 1, 0),
    jitterGrowth: num(p.jitterGrowth, 0, 1, 0),
    clearRadius: num(p.clearRadius, 0, 60, 0),
    grow: num(p.grow, 0, 1, 1),
    cutoffArc: Boolean(p.cutoffArc),
    invert: Boolean(p.invert),
    layer2: Boolean(p.layer2),
    field: p.align === "text" ? alignedField(p.field) : freeField(p.field),
  }
}

/** A field as given, with its bottom kept at or above `fieldBottomMax`, clear of the cover label. */
function freeField(field: Box): Box {
  const y = Number.isFinite(field.y) ? Math.min(fieldBottomMax - 10, Math.max(0, field.y)) : 0
  const h = Number.isFinite(field.h) ? field.h : defaults.field.h
  return {
    x: Number.isFinite(field.x) ? Math.min(210, Math.max(0, field.x)) : 0,
    y,
    w: Number.isFinite(field.w) ? Math.min(220, Math.max(10, field.w)) : defaults.field.w,
    h: Math.min(fieldBottomMax - y, Math.max(10, h)),
  }
}

/** The field framed on the text's left edge with the same inset right and top; its bottom stays where it was. */
function alignedField(field: Box): Box {
  const bottom = Number.isFinite(field.y + field.h)
    ? Math.min(fieldBottomMax, Math.max(textX + 10, field.y + field.h))
    : defaults.field.h
  return { x: textX, y: textX, w: 210 - 2 * textX, h: bottom - textX }
}

type Point = { x: number; y: number; theta: number; row: number; col: number; index: number }

/**
 * The pattern as SVG markup in the field's own coordinates (0..field.w, 0..field.h), plus how many
 * elements it drew.
 */
export function renderPattern(input: Partial<PatternParams>) {
  const fit = fitLogo(normalize(input))
  const p = alignedGrid(fit.params)
  const mark = fit.logo
  const clearLogo = fit.clear
  const w = p.field.w
  const h = p.field.h
  const m = p.margin
  // Aligned to the text, a grid's first column and row sit with their edges on the field's left and top.
  const anchored = p.align === "text" && p.mode === "pattern" && p.layout === "grid"
  const centre = anchored
    ? { x: p.size / 2 + ((p.count - 1) / 2) * p.spacing, y: p.size / 2 }
    : { x: p.cx * w, y: p.cy * h }
  const clipRadius = Math.max(0, Math.min(w, h) / 2 - m)
  const reach =
    p.clip === "circle" ? clipRadius + Math.hypot(w / 2 - centre.x, h / 2 - centre.y) : maxCornerDistance(centre, w, h)
  const falloffRadius = p.clip === "circle" ? clipRadius : Math.hypot(w - 2 * m, h - 2 * m) / 2
  const exclude =
    clearLogo > 0
      ? {
          x: mark.x - clearLogo - p.field.x,
          y: mark.y - clearLogo - p.field.y,
          w: mark.w + 2 * clearLogo,
          h: mark.h + 2 * clearLogo,
        }
      : undefined
  const block = p.clearBlock
    ? {
        x0: Math.floor((mark.x - p.field.x) / p.spacing) * p.spacing,
        y0: Math.floor((mark.y - p.field.y) / p.spacing) * p.spacing,
        x1: (Math.ceil((mark.x + mark.w - p.field.x) / p.spacing - 1e-9) + p.clearSteps) * p.spacing,
        y1: (Math.ceil((mark.y + mark.h - p.field.y) / p.spacing - 1e-9) + p.clearSteps) * p.spacing,
      }
    : undefined
  const ink = p.invert ? "#fff" : "#000"
  const fills: string[] = []
  const strokes: string[] = []
  const counter = { drawn: 0 }
  const gaps = { right: Infinity, bottom: Infinity }
  /** The drawn elements' outer edges on the sheet, in mm (strokes excluded). */
  const bounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }

  const layers = p.mode === "emitter" ? [] : p.layer2 ? [0, 1] : [0]
  layers.forEach((layer) => {
    const angle = layer === 1 ? (p.layer2Angle * Math.PI) / 180 : 0
    const scale = layer === 1 ? p.layer2Scale : 1
    const shift = layer === 1 ? { x: p.layer2ShiftX, y: p.layer2ShiftY } : { x: 0, y: 0 }
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const layerReach = (reach + Math.hypot(shift.x, shift.y)) / scale
    const fieldTop = { x: -centre.x, y: -centre.y }
    layout(p, layerReach, fieldTop).forEach((point) => {
      const k = point.index
      const r = (slot: number) => hash(p.seed, layer, k, slot)
      if (p.dropout > 0 && r(0) < p.dropout) return

      const lx = point.x * scale
      const ly = point.y * scale
      const baseX = centre.x + lx * cos - ly * sin + shift.x + (r(1) - 0.5) * p.jitter * p.spacing
      const phase = (2 * Math.PI * p.warpFreq * baseX) / w + (p.warpPhase * Math.PI) / 180
      const slope = (p.warpAmp * 2 * Math.PI * p.warpFreq * Math.cos(phase)) / w
      const x = baseX
      const y =
        centre.y + lx * sin + ly * cos + shift.y + (r(2) - 0.5) * p.jitter * p.spacing + p.warpAmp * Math.sin(phase)

      const distance = Math.hypot(x - centre.x, y - centre.y)
      const s = Math.min(3, Math.max(0, 1 - (p.falloff * distance) / Math.max(falloffRadius, 1)))
      const step = steps(p, point, x, y, distance)
      const base =
        p.orient === "tangent"
          ? point.theta * (180 / Math.PI) + 90
          : p.orient === "radial"
            ? point.theta * (180 / Math.PI)
            : 0
      const raw =
        base +
        p.offset +
        p.rotation * step +
        (r(3) - 0.5) * p.jitter * 90 +
        (Math.atan(slope) * 180) / Math.PI +
        (angle * 180) / Math.PI
      const rotation = p.snap > 0 ? Math.round(raw / p.snap) * p.snap : raw
      const stretch = p.primitive === "lines" && p.warpAmp !== 0 ? Math.sqrt(1 + slope * slope) : 1

      place({
        x,
        y,
        shape: p.primitive,
        size: p.size * s * scale,
        length: p.length * s * scale * stretch,
        rotation,
        wobble: p.jitter,
        r,
      })
    })
  })

  if (p.mode === "emitter") emitInto(p, place)

  function place(e: Element) {
    if (counter.drawn >= maxElements) return
    const linear = e.shape === "lines" || e.shape === "crosses"
    if ((linear ? e.length : e.size) < minimum) return
    const solid = e.shape === "dots" || (e.shape === "squares" && p.fill === "solid")
    const extent = linear
      ? e.length / 2
      : e.shape === "squares"
        ? squareExtent(e.size, e.rotation) + e.wobble * e.size * 0.12
        : e.size / 2
    const pad = extent + (solid ? 0 : p.weight / 2)
    if (!inside(p, e.x, e.y, pad, w, h, clipRadius)) return
    if (
      exclude &&
      e.x + pad > exclude.x &&
      e.x - pad < exclude.x + exclude.w &&
      e.y + pad > exclude.y &&
      e.y - pad < exclude.y + exclude.h
    )
      return
    if (block && e.x >= block.x0 && e.x < block.x1 && e.y >= block.y0 && e.y < block.y1) return
    if (p.clearRadius > 0) {
      const dx = Math.max(mark.x - p.field.x - e.x, 0, e.x - (mark.x + mark.w - p.field.x))
      const dy = Math.max(mark.y - p.field.y - e.y, 0, e.y - (mark.y + mark.h - p.field.y))
      if (Math.hypot(dx, dy) < p.clearRadius + pad) return
    }
    counter.drawn++
    bounds.x0 = Math.min(bounds.x0, e.x - extent + p.field.x)
    bounds.x1 = Math.max(bounds.x1, e.x + extent + p.field.x)
    bounds.y0 = Math.min(bounds.y0, e.y - extent + p.field.y)
    bounds.y1 = Math.max(bounds.y1, e.y + extent + p.field.y)
    // The measured gaps from the logo's right edge to the nearest element beside it, and from its bottom edge to the nearest below it.
    const box = { x0: e.x - extent, x1: e.x + extent, y0: e.y - extent, y1: e.y + extent }
    const right = mark.x + mark.w - p.field.x
    const bottom = mark.y + mark.h - p.field.y
    if (box.y1 > mark.y - p.field.y && box.y0 < bottom && box.x0 >= right - 1e-9)
      gaps.right = Math.min(gaps.right, box.x0 - right)
    if (box.x1 > mark.x - p.field.x && box.x0 < right && box.y0 >= bottom - 1e-9)
      gaps.bottom = Math.min(gaps.bottom, box.y0 - bottom)
    draw(p, e, fills, strokes)
  }

  const background = !p.invert
    ? ""
    : p.clip === "circle"
      ? `<circle cx="${n(w / 2)}" cy="${n(h / 2)}" r="${n(clipRadius)}" fill="#000"/>`
      : `<rect x="${n(m)}" y="${n(m)}" width="${n(w - 2 * m)}" height="${n(h - 2 * m)}" fill="#000"/>`
  const markup = [
    background,
    fills.length ? `<path fill="${ink}" d="${fills.join("")}"/>` : "",
    strokes.length
      ? `<path fill="none" stroke="${ink}" stroke-width="${n(p.weight)}" stroke-linecap="butt" stroke-linejoin="miter" d="${strokes.join("")}"/>`
      : "",
  ].join("")
  return {
    markup,
    width: w,
    height: h,
    count: counter.drawn,
    capped: counter.drawn >= maxElements,
    logo: mark,
    gaps,
    bounds,
    spacing: p.spacing,
  }
}

/**
 * A grid aligned to the text fills the field's width: as many columns as fit from the left edge, and
 * with `fitSpan` the pitch stretched so the last square's outer edge lands on the right edge.
 */
function alignedGrid(p: PatternParams): PatternParams {
  if (p.align !== "text" || p.mode !== "pattern" || p.layout !== "grid") return p
  const span = p.field.w - p.size
  if (p.fitSpan) {
    const steps = Math.max(1, Math.round(span / p.spacing))
    return { ...p, spacing: span / steps, count: steps + 1 }
  }
  return { ...p, count: Math.floor(span / p.spacing + 1e-9) + 1 }
}

/** The smallest gap kept between a fitted logo and the grid, in mm: a square touching the logo is cleared. */
const fitGap = 0.5

/**
 * The logo's box for these params and the params the grid uses with it (only "pitch" changes them),
 * plus the clear space kept round the logo.
 */
export function fitLogo(p: PatternParams): { params: PatternParams; logo: Box; clear: number } {
  if (p.mode !== "pattern" || p.logoFit === "none") return { params: p, logo, clear: p.clearLogo }
  const clear = Math.max(p.clearLogo, fitGap)
  if (p.logoFit === "pitch") return { params: { ...p, spacing: logo.w / 4 }, logo, clear }
  if (p.logoFit === "pixel") return { params: p, logo: { ...logo, w: 4 * p.spacing, h: 5 * p.spacing }, clear }
  // "size": the width from 10 to 13mm (in 0.01mm steps) whose right and bottom gaps differ least.
  const best = Array.from({ length: 301 }, (_, i) => 10 + i / 100).reduce(
    (found, w) => {
      const gaps = gridGaps(p, { ...logo, w, h: w * 1.25 }, clear)
      const miss = Math.abs(gaps.right - gaps.bottom)
      return miss < found.miss - 1e-9 ? { w, miss } : found
    },
    { w: logo.w, miss: Infinity },
  )
  return { params: p, logo: { ...logo, w: best.w, h: best.w * 1.25 }, clear }
}

/**
 * The gaps from a box's right and bottom edges to the next grid line (a square's left or top edge)
 * at least `clear` away, on a grid whose lines start at the field's left and top edges.
 */
export function gridGaps(p: PatternParams, box: Box, clear: number) {
  const gap = (origin: number, edge: number) =>
    origin + Math.ceil((edge + clear - origin) / p.spacing - 1e-9) * p.spacing - edge
  return { right: gap(p.field.x, box.x + box.w), bottom: gap(p.field.y, box.y + box.h) }
}

/** The pattern alone, as a standalone SVG document sized in mm. */
export function patternSVG(input: Partial<PatternParams>) {
  const result = renderPattern(input)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(result.width)}mm" height="${n(result.height)}mm" viewBox="0 0 ${n(result.width)} ${n(result.height)}">${result.markup}</svg>`
}

/** The pattern placed on the A4 cover, as a `<g>` in sheet coordinates (mm). */
export function coverFieldMarkup(input: Partial<PatternParams>) {
  const p = normalize(input)
  return `<g transform="translate(${n(p.field.x)} ${n(p.field.y)})">${renderPattern(p).markup}</g>`
}

/** The mark's black cells on its 4 × 5 grid (column, row), each 2.5mm on the cover. */
const markCells = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [0, 1],
  [3, 1],
  [0, 2],
  [3, 2],
  [0, 3],
  [3, 3],
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
]

const morphShapes: Record<Morph, Primitive[]> = {
  none: [],
  "dot-square-cross-line": ["dots", "squares", "crosses", "lines"],
  "dot-square": ["dots", "squares"],
  "dot-cross": ["dots", "crosses"],
  "dot-circle-square": ["dots", "circles", "squares"],
  "square-cross-line": ["squares", "crosses", "lines"],
  "dot-line": ["dots", "lines"],
}

/** An emitted element before styling: where it is on the sheet, how far it has travelled, and which way. */
type Emitted = { x: number; y: number; dist: number; heading: number }

/**
 * The emitter: elements radiate out of the cover logo. Each one's size, rotation, shape and density
 * follow its distance from the logo, through the eased from → to ranges, so the field reads as a
 * machine unfolding out of the mark.
 */
function emitInto(p: PatternParams, place: (e: Element) => void) {
  const emitted = emitPoints(p)
  const front = p.grow * p.reach
  const morph = morphShapes[p.morph]
  emitted.forEach((point, index) => {
    const r = (slot: number) => hash(p.seed, 7, index, slot)
    const t = Math.min(1, point.dist / p.reach)
    if (p.grow < 1 && point.dist > front) return
    if (p.dropout > 0 && r(0) < p.dropout) return
    if (p.densityFalloff > 0 && r(4) < p.densityFalloff * t) return

    const local = p.spacing * (1 + ((p.growth - 1) * Math.min(point.dist, p.reach)) / p.reach)
    const fade = p.grow < 1 ? smooth(Math.min(1, (front - point.dist) / (3 * local))) : 1
    const wave = 1 - p.waveAmp * (0.5 - 0.5 * Math.cos(2 * Math.PI * (p.waves * t - p.wavePhase)))
    const size = (p.sizeFrom + (p.sizeTo - p.sizeFrom) * ease(p.sizeEase, t, p.easeSteps)) * wave * fade
    const jitter = p.jitter * (1 - p.jitterGrowth + p.jitterGrowth * t)
    const heading = (point.heading * 180) / Math.PI
    const base = p.orient === "tangent" ? heading + 90 : p.orient === "radial" ? heading : 0
    const raw =
      base + p.offset + p.rotFrom + (p.rotTo - p.rotFrom) * ease(p.rotEase, t, p.easeSteps) + (r(3) - 0.5) * jitter * 90
    const span = Math.max(1e-6, p.morphTo - p.morphFrom)
    const shape = morph.length
      ? morph[Math.min(morph.length - 1, Math.max(0, Math.floor(((t - p.morphFrom) / span) * morph.length)))]
      : p.primitive
    place({
      x: point.x - p.field.x + (r(1) - 0.5) * jitter * local,
      y: point.y - p.field.y + (r(2) - 0.5) * jitter * local,
      shape,
      size,
      length: size * (shape === "lines" ? p.lineRatio : 1),
      rotation: p.snap > 0 ? Math.round(raw / p.snap) * p.snap : raw,
      wobble: jitter,
      r,
    })
  })
}

function emitPoints(p: PatternParams): Emitted[] {
  const centre = { x: logo.x + logo.w / 2, y: logo.y + logo.h / 2 }
  const origin =
    p.emitFrom === "top-left"
      ? { x: logo.x, y: logo.y }
      : p.emitFrom === "bottom-right"
        ? { x: logo.x + logo.w, y: logo.y + logo.h }
        : centre
  const field = p.field
  const far =
    Math.max(
      ...[
        [field.x, field.y],
        [field.x + field.w, field.y],
        [field.x, field.y + field.h],
        [field.x + field.w, field.y + field.h],
      ].map(([x, y]) => Math.hypot(x - origin.x, y - origin.y)),
    ) +
    2 * p.spacing
  const limit = p.cutoffArc ? Math.min(p.reach, far) : far
  // Spacing grows linearly with distance: base distance ρ maps to ρ + aρ², whose slope is `growth` at `reach`.
  const a = (p.growth - 1) / (2 * p.reach)
  const grow = (rho: number) => rho + a * rho * rho
  const slope = (rho: number) => 1 + 2 * a * rho
  const rhoMax = a === 0 ? limit : 1 + 4 * a * limit >= 0 ? (-1 + Math.sqrt(1 + 4 * a * limit)) / (2 * a) : -1 / (2 * a)
  const from = (p.sweepFrom * Math.PI) / 180
  const width = (Math.max(0, p.sweepTo - p.sweepFrom) * Math.PI) / 180
  const full = width >= 2 * Math.PI - 1e-6
  const s = p.spacing
  const multi = p.emitFrom === "outline" || p.emitFrom === "cells"
  const seeds = multi
    ? p.emitFrom === "cells"
      ? markCells.map(([col, row]) => {
          const x = logo.x + (col + 0.5) * (logo.w / 4)
          const y = logo.y + (row + 0.5) * (logo.w / 4)
          return { x, y, dir: Math.atan2(y - centre.y, x - centre.x) }
        })
      : perimeter(logo, 0, logo.w / 4, logo.w / 8).map((point) => ({ x: point.x, y: point.y, dir: point.normal }))
    : [{ ...origin, dir: from + width / 2 }]
  const armAngles = (seed: { dir: number }) =>
    multi && p.aim === "outward"
      ? [seed.dir]
      : Array.from({ length: p.arms }, (_, i) =>
          full
            ? from + (i * 2 * Math.PI) / p.arms
            : p.arms === 1
              ? from + width / 2
              : from + (i * width) / (p.arms - 1),
        )
  // Base distances along a path, one spacing apart, moved out by the wave phase and the stagger.
  const along = (shift: number) =>
    Array.from(
      { length: Math.max(0, Math.ceil(rhoMax / s) + 2) },
      (_, k) => (k + (p.wavePhase % 1) + shift) * s,
    ).filter((rho) => rho > s * 0.25 && rho <= rhoMax)
  const filterCentre = multi ? centre : origin
  const inSweep = (x: number, y: number) =>
    full ||
    (((Math.atan2(y - filterCentre.y, x - filterCentre.x) - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) <=
      width + 1e-9
  const out: Emitted[] = []
  const push = (point: Emitted) => {
    if (out.length < 250000 && inSweep(point.x, point.y)) out.push(point)
  }

  if (p.distribution === "rays")
    seeds.forEach((seed) =>
      armAngles(seed).forEach((angle, i) =>
        along(i % 2 ? p.stagger / 2 : 0).forEach((rho) => {
          const dist = grow(rho)
          push({ x: seed.x + dist * Math.cos(angle), y: seed.y + dist * Math.sin(angle), dist, heading: angle })
        }),
      ),
    )

  if (p.distribution === "spiral") {
    const curl = (p.curl * Math.PI) / 180
    seeds.forEach((seed) =>
      armAngles(seed).forEach((angle, i) =>
        along(i % 2 ? p.stagger / 2 : 0).forEach((rho) => {
          const dist = grow(rho)
          const theta = angle + curl * dist
          // The path's direction: outward plus the turn the curl adds per mm.
          const heading = theta + Math.atan(curl * dist)
          push({ x: seed.x + dist * Math.cos(theta), y: seed.y + dist * Math.sin(theta), dist, heading })
        }),
      ),
    )
  }

  if (p.distribution === "ripples") {
    if (p.emitFrom === "outline")
      along(0).forEach((rho, k) =>
        perimeter(logo, grow(rho), s * slope(rho), k % 2 ? (p.stagger * s * slope(rho)) / 2 : 0).forEach((point) =>
          push({ x: point.x, y: point.y, dist: grow(rho), heading: point.normal }),
        ),
      )
    if (p.emitFrom !== "outline")
      seeds.forEach((seed) =>
        along(0).forEach((rho, k) => {
          const step = s / rho
          const span = multi || full ? 2 * Math.PI : width
          const count = full || multi ? Math.max(3, Math.round(span / step)) : Math.floor(span / step) + 1
          const start = (multi || full ? 0 : from) + (k % 2 ? (p.stagger * step) / 2 : 0)
          const dist = grow(rho)
          Array.from({ length: count }, (_, j) => start + j * (multi || full ? span / count : step)).forEach((angle) =>
            push({ x: seed.x + dist * Math.cos(angle), y: seed.y + dist * Math.sin(angle), dist, heading: angle }),
          )
        }),
      )
  }

  if (p.distribution === "fan") {
    const share = multi || full ? 1 : width / (2 * Math.PI)
    const golden = (Math.sqrt(5) - 1) / 2
    seeds.forEach((seed) =>
      Array.from({ length: p.points }, (_, i) => i + 1).forEach((i) => {
        const rho = s * Math.sqrt(i / (Math.PI * share))
        if (rho > rhoMax) return
        const turn = (i * golden) % 1
        const angle = multi || full ? turn * 2 * Math.PI : from + turn * width
        const dist = grow(rho)
        push({ x: seed.x + dist * Math.cos(angle), y: seed.y + dist * Math.sin(angle), dist, heading: angle })
      }),
    )
  }

  if (p.distribution === "flow") {
    const bend = (p.bend * Math.PI) / 180
    seeds.forEach((seed) =>
      armAngles(seed).forEach((angle, i) => {
        // A cubic Bézier per stream, bent one way then the other, sampled finely and walked by arc length.
        const length = limit * 1.05
        const c1 = {
          x: seed.x + (length / 3) * Math.cos(angle + bend),
          y: seed.y + (length / 3) * Math.sin(angle + bend),
        }
        const c2 = {
          x: seed.x + ((2 * length) / 3) * Math.cos(angle - bend),
          y: seed.y + ((2 * length) / 3) * Math.sin(angle - bend),
        }
        const end = { x: seed.x + length * Math.cos(angle), y: seed.y + length * Math.sin(angle) }
        const samples = Array.from({ length: 601 }, (_, j) => {
          const u = j / 600
          const v = 1 - u
          return {
            x: v * v * v * seed.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * end.x,
            y: v * v * v * seed.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * end.y,
          }
        })
        const lengths = samples.reduce<number[]>((acc, point, j) => {
          acc.push(j === 0 ? 0 : acc[j - 1] + Math.hypot(point.x - samples[j - 1].x, point.y - samples[j - 1].y))
          return acc
        }, [])
        along(i % 2 ? p.stagger / 2 : 0).forEach((rho) => {
          const dist = grow(rho)
          const j = lengths.findIndex((value) => value >= dist)
          if (j <= 0) return
          const f = (dist - lengths[j - 1]) / Math.max(1e-9, lengths[j] - lengths[j - 1])
          const a0 = samples[j - 1]
          const a1 = samples[j]
          push({
            x: a0.x + (a1.x - a0.x) * f,
            y: a0.y + (a1.y - a0.y) * f,
            dist,
            heading: Math.atan2(a1.y - a0.y, a1.x - a0.x),
          })
        })
      }),
    )
  }

  if (p.distribution === "warpgrid") {
    const curl = (p.curl * Math.PI) / 180
    const centreOf = multi ? centre : origin
    const half = Math.ceil(rhoMax / s) + 1
    Array.from({ length: 2 * half + 1 }, (_, i) => i - half).forEach((row) =>
      Array.from({ length: 2 * half + 1 }, (_, j) => j - half).forEach((col) => {
        const gx = (col + (row % 2 ? p.stagger / 2 : 0)) * s
        const gy = row * s
        const rho = Math.hypot(gx, gy) + (p.wavePhase % 1) * s
        if (rho > rhoMax) return
        const dist = grow(rho)
        const theta = Math.atan2(gy, gx) + curl * dist
        push({ x: centreOf.x + dist * Math.cos(theta), y: centreOf.y + dist * Math.sin(theta), dist, heading: theta })
      }),
    )
  }

  if (p.distribution === "echoes") {
    // Echoes scale about the logo's centre: scaling about a corner would stack every copy's edges on one line.
    const anchor = centre
    const farCorner = Math.max(
      ...[
        [logo.x, logo.y],
        [logo.x + logo.w, logo.y],
        [logo.x, logo.y + logo.h],
        [logo.x + logo.w, logo.y + logo.h],
      ].map(([x, y]) => Math.hypot(x - anchor.x, y - anchor.y)),
    )
    along(0).forEach((rho, k) => {
      const dist = grow(rho)
      const scale = 1 + dist / farCorner
      const scaled = (box: Box) => ({
        x: anchor.x + (box.x - anchor.x) * scale,
        y: anchor.y + (box.y - anchor.y) * scale,
        w: box.w * scale,
        h: box.h * scale,
      })
      const step = s * slope(rho)
      perimeter(scaled(logo), 0, step, k % 2 ? (p.stagger * step) / 2 : 0).forEach((point) =>
        push({ x: point.x, y: point.y, dist, heading: point.normal }),
      )
    })
  }

  return out
}

/**
 * Points every `step` mm around a box grown by `radius` (a rounded rectangle, or the box itself at
 * 0), clockwise from its top-left, each with its outward normal.
 */
function perimeter(box: Box, radius: number, step: number, offset: number) {
  const quarter = (Math.PI / 2) * radius
  const pieces = [
    { length: box.w, at: (u: number) => ({ x: box.x + u, y: box.y - radius, normal: -Math.PI / 2 }) },
    {
      length: quarter,
      at: (u: number) => arcPoint(box.x + box.w, box.y, radius, -Math.PI / 2 + u / Math.max(radius, 1e-9)),
    },
    { length: box.h, at: (u: number) => ({ x: box.x + box.w + radius, y: box.y + u, normal: 0 }) },
    { length: quarter, at: (u: number) => arcPoint(box.x + box.w, box.y + box.h, radius, u / Math.max(radius, 1e-9)) },
    { length: box.w, at: (u: number) => ({ x: box.x + box.w - u, y: box.y + box.h + radius, normal: Math.PI / 2 }) },
    {
      length: quarter,
      at: (u: number) => arcPoint(box.x, box.y + box.h, radius, Math.PI / 2 + u / Math.max(radius, 1e-9)),
    },
    { length: box.h, at: (u: number) => ({ x: box.x - radius, y: box.y + box.h - u, normal: Math.PI }) },
    { length: quarter, at: (u: number) => arcPoint(box.x, box.y, radius, Math.PI + u / Math.max(radius, 1e-9)) },
  ]
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0)
  const count = Math.max(1, Math.floor((total - offset) / step - 1e-9) + 1)
  return Array.from({ length: Math.min(count, 20000) }, (_, i) => offset + i * step).map((u) => {
    const found = pieces.reduce(
      (state, piece) =>
        state.done
          ? state
          : state.left <= piece.length
            ? { ...state, done: true, piece }
            : { ...state, left: state.left - piece.length },
      { left: u, done: false, piece: pieces[0] },
    )
    return found.piece.at(Math.min(found.left, found.piece.length))
  })
}

function arcPoint(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), normal: angle }
}

/** An easing of t in [0, 1]. */
function ease(kind: Ease, t: number, steps: number) {
  if (kind === "ease") return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  if (kind === "in") return t * t
  if (kind === "out") return 1 - (1 - t) * (1 - t)
  if (kind === "exp") return t === 0 ? 0 : (Math.pow(2, 10 * t) - 1) / 1023
  if (kind === "step") return Math.min(1, Math.floor(t * steps) / (steps - 1))
  return t
}

function smooth(t: number) {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

function layout(p: PatternParams, reach: number, fieldTop: { x: number; y: number }): Point[] {
  const s = p.spacing
  if (p.layout === "grid") {
    const half = Math.ceil(reach / s)
    const first = -(p.count - 1) / 2
    return Array.from({ length: 2 * half + 1 }, (_, i) => i - half).flatMap((row) =>
      Array.from({ length: p.count }, (_, j) => j)
        .filter((j) => Math.abs((first + j) * s) <= reach + s)
        .map((j) => {
          const x = (first + j) * s
          const y = row * s
          return {
            x,
            y,
            theta: Math.atan2(y, x),
            row: Math.round((y - fieldTop.y) / s),
            col: Math.round((x - fieldTop.x) / s),
            index: (row + half) * p.count + j,
          }
        }),
    )
  }
  if (p.layout === "radial") {
    const rings = Math.ceil(reach / s)
    return [
      { x: 0, y: 0, theta: 0, row: 0, col: 0, index: 0 },
      ...Array.from({ length: rings }, (_, i) => i + 1).flatMap((ring) =>
        Array.from({ length: p.count }, (_, j) => {
          const theta = (2 * Math.PI * j) / p.count
          return {
            x: ring * s * Math.cos(theta),
            y: ring * s * Math.sin(theta),
            theta,
            row: ring,
            col: j,
            index: ring * p.count + j,
          }
        }),
      ),
    ]
  }
  if (p.layout === "rings") {
    return [
      { x: 0, y: 0, theta: 0, row: 0, col: 0, index: 0 },
      ...Array.from({ length: Math.min(p.count, Math.ceil(reach / s)) }, (_, i) => i + 1).flatMap((ring) => {
        const around = Math.max(3, Math.round((2 * Math.PI * ring * s) / s))
        return Array.from({ length: around }, (_, j) => {
          const theta = (2 * Math.PI * j) / around
          return {
            x: ring * s * Math.cos(theta),
            y: ring * s * Math.sin(theta),
            theta,
            row: ring,
            col: j,
            index: ring * 100000 + j,
          }
        })
      }),
    ]
  }
  if (p.layout === "spiral") {
    // An Archimedean spiral with `spacing` between turns, sampled every `spacing` along its length.
    const b = s / (2 * Math.PI)
    return Array.from({ length: p.count })
      .reduce<{ points: Point[]; phi: number }>(
        (state, _, index) => {
          const radius = b * state.phi
          const theta = state.phi % (2 * Math.PI)
          state.points.push({
            x: radius * Math.cos(state.phi),
            y: radius * Math.sin(state.phi),
            theta,
            row: Math.floor(state.phi / (2 * Math.PI)),
            col: index,
            index,
          })
          return { points: state.points, phi: state.phi + s / Math.sqrt(radius * radius + b * b) }
        },
        { points: [], phi: 2 * Math.PI },
      )
      .points.filter((point) => Math.hypot(point.x, point.y) <= reach + s)
  }
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: p.count }, (_, index) => {
    const radius = s * Math.sqrt(index)
    const theta = index * golden
    return {
      x: radius * Math.cos(theta),
      y: radius * Math.sin(theta),
      theta: theta % (2 * Math.PI),
      row: Math.floor(radius / s),
      col: index,
      index,
    }
  }).filter((point) => Math.hypot(point.x, point.y) <= reach + s)
}

/** How many rotation steps an element is from the start, along the chosen axis. */
function steps(p: PatternParams, point: Point, x: number, y: number, distance: number) {
  if (p.axis === "row") return point.row
  if (p.axis === "column") return point.col
  if (p.axis === "diagonal") return point.row + point.col
  if (p.axis === "distance") return distance / p.spacing
  if (p.axis === "angle") return (((point.theta * 180) / Math.PI + 360) % 360) / 10
  if (p.axis === "index") return point.index % 100000
  return noise(p.seed, x / p.noiseScale, y / p.noiseScale) * 36
}

function inside(p: PatternParams, x: number, y: number, pad: number, w: number, h: number, radius: number) {
  if (p.clip === "circle") return Math.hypot(x - w / 2, y - h / 2) + pad <= radius
  const edge = 1e-6
  return (
    x - pad >= p.margin - edge &&
    x + pad <= w - p.margin + edge &&
    y - pad >= p.margin - edge &&
    y + pad <= h - p.margin + edge
  )
}

/** Half the width of a square's bounding box at a rotation, in degrees: exact, so squares can sit right on the field's edge. */
function squareExtent(size: number, rotation: number) {
  const a = (rotation * Math.PI) / 180
  return (size / 2) * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)))
}

type Element = {
  x: number
  y: number
  shape: Primitive
  size: number
  length: number
  rotation: number
  /** 0–1: how far the corners of a square wander. */
  wobble: number
  r: (slot: number) => number
}

function draw(p: PatternParams, e: Element, fills: string[], strokes: string[]) {
  const a = (e.rotation * Math.PI) / 180
  const segment = (angle: number, length: number) => {
    const dx = (Math.cos(angle) * length) / 2
    const dy = (Math.sin(angle) * length) / 2
    return `M${n(e.x - dx)} ${n(e.y - dy)}L${n(e.x + dx)} ${n(e.y + dy)}`
  }
  const circle = (radius: number) =>
    `M${n(e.x - radius)} ${n(e.y)}a${n(radius)} ${n(radius)} 0 1 0 ${n(2 * radius)} 0a${n(radius)} ${n(radius)} 0 1 0 ${n(-2 * radius)} 0Z`
  const copies = Array.from({ length: p.nest }, (_, i) => 1 - i / p.nest).filter((f) => e.size * f >= minimum)

  if (e.shape === "dots") return fills.push(circle(Math.max(e.size, minimum) / 2))
  if (e.shape === "lines") return strokes.push(segment(a, e.length))
  if (e.shape === "crosses") return strokes.push(segment(a, e.length) + segment(a + Math.PI / 2, e.length))
  if (e.shape === "circles") return strokes.push(copies.map((f) => circle((e.size * f) / 2)).join(""))
  if (e.shape === "arcs") {
    const span = (Math.min(359.9, Math.max(1, p.arc)) * Math.PI) / 180
    return strokes.push(
      copies
        .map((f) => {
          const radius = (e.size * f) / 2
          const start = { x: e.x + radius * Math.cos(a), y: e.y + radius * Math.sin(a) }
          const end = { x: e.x + radius * Math.cos(a + span), y: e.y + radius * Math.sin(a + span) }
          return `M${n(start.x)} ${n(start.y)}A${n(radius)} ${n(radius)} 0 ${span > Math.PI ? 1 : 0} 1 ${n(end.x)} ${n(end.y)}`
        })
        .join(""),
    )
  }
  const square = (f: number, copy: number) => {
    const half = (e.size * f) / 2
    const wobble = e.wobble * e.size * 0.12
    return (
      [
        [-half, -half],
        [half, -half],
        [half, half],
        [-half, half],
      ]
        .map(([sx, sy], corner) => {
          const jx = sx + (e.r(10 + copy * 8 + corner * 2) - 0.5) * wobble
          const jy = sy + (e.r(11 + copy * 8 + corner * 2) - 0.5) * wobble
          return `${corner === 0 ? "M" : "L"}${n(e.x + jx * Math.cos(a) - jy * Math.sin(a))} ${n(e.y + jx * Math.sin(a) + jy * Math.cos(a))}`
        })
        .join("") + "Z"
    )
  }
  if (p.fill === "solid") return fills.push(square(1, 0))
  return strokes.push(copies.map((f, copy) => square(f, copy)).join(""))
}

function maxCornerDistance(c: { x: number; y: number }, w: number, h: number) {
  return Math.max(
    Math.hypot(c.x, c.y),
    Math.hypot(w - c.x, c.y),
    Math.hypot(c.x, h - c.y),
    Math.hypot(w - c.x, h - c.y),
  )
}

/** A number for SVG output: three decimals, no trailing zeros. */
function n(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

/** A deterministic value in [0, 1) for a seed and three integers. */
function hash(seed: number, a: number, b: number, c: number) {
  const mixed = [a, b, c].reduce((value, part) => {
    const next = Math.imul(value ^ (part | 0), 0x9e3779b1)
    return Math.imul(next ^ (next >>> 15), 0x85ebca6b)
  }, seed | 0)
  const final = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35)
  return ((final ^ (final >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1). */
function noise(seed: number, x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ease = (t: number) => t * t * (3 - 2 * t)
  const corner = (dx: number, dy: number) => hash(seed, ix + dx, iy + dy, 7919)
  const top = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * ease(fx)
  const bottom = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * ease(fx)
  return top + (bottom - top) * ease(fy)
}
