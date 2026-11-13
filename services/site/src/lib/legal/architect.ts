import { modules } from "~/lib/font-content"

/*
 * The "architect" print style's layout: where every element of the cover and of the interior pages
 * sits, in millimetres on an A4 sheet (210 × 297). The cover concepts (c1–c5), the interior
 * concepts (i1–i4) and the layout editor (/dev/print-editor) all produce one of these, and the
 * print CSS is generated from it, so a layout saved in the editor is what the legal pages print.
 * Elements in the lower half of the cover are anchored to the bottom edge, so US Letter (18mm
 * shorter) keeps them in place.
 */

/**
 * The square grid's module (pitch) and square size, in mm: 0.425mm squares (about 1.2pt, well above
 * the ~0.1mm a printer can hold) every 4mm, so a row or column holds 25% more of them than at 5mm.
 */
export const module = 4
export const square = 0.425
/** The one weight of every rule (form blocks, tables, summary, colophon): half a grid square, about 0.6pt. */
export const rule = square / 2
/**
 * The cover form block's row pitch, in mm: 24 CSS pixels. Chromium paints text baselines on whole
 * CSS pixels, so a whole-pixel pitch (from a whole-pixel top) puts every row the same distance from
 * its rules.
 */
export const formRow = 6.35

/** A length in mm, rounded to whole CSS pixels (96 per inch). */
export const wholePixels = (value: number) => (Math.round((value * 96) / 25.4) * 25.4) / 96

export const page = { width: 210, height: 297 }

/**
 * The real sheet widths in Chromium's print, in mm: its A4 is 595.92pt wide, and US Letter 612pt.
 * A full-width square grid spans the A4 sheet, so its outer squares sit the same distance from both
 * edges; on Letter it moves right by half the difference.
 */
export const sheet = { a4: 210.2, letter: 215.9 }

export type Box = { x: number; y: number; w: number; h: number; visible: boolean }

export type ArchitectLayout = {
  version: 1
  cover: {
    /** The square-grid field, with an optional solid pattern ("o"/"c" from the font, a corner) or band. */
    field: Box & { pattern: "none" | "o" | "c" | "corner"; band: "none" | "row" | "column"; bandAt: number }
    logo: Box
    title: Box & { size: number }
    form: Box & { size: number }
  }
  interior: {
    /** The text area: its edges are the @page margins. */
    body: Box
    /**
     * The meta column for section numbers, inside the text area. With `inMargin` the left margin is
     * the meta column: it holds the grid, and the numbers run in before the headings.
     */
    meta: { w: number; inMargin: boolean }
    /** The square grid on interior pages: a strip in the left margin, a band in the top margin, or corner marks. */
    grid: Box & { kind: "strip" | "band" | "marks" }
    /** The running footer: the document's values and the page number under a rule. */
    footer: { visible: boolean }
    /** Extra space above the text on the first interior page, in mm. */
    opening: number
    /** Body text size, in pt. */
    size: number
  }
  /** Edited labels and static text, by key; missing keys use the defaults. */
  text: Record<string, string>
}

export const coverConcepts = ["c1", "c2", "c3", "c4", "c5"] as const
export const interiorConcepts = ["plain", "i1", "i2", "i3", "i4"] as const
export type CoverConcept = (typeof coverConcepts)[number]
export type InteriorConcept = (typeof interiorConcepts)[number]

export const coverNames: Record<CoverConcept, string> = {
  c1: "Full-bleed field",
  c2: "Field with a clean margin",
  c3: "Field stops above the title",
  c4: "Field with the font's “o” in solid squares",
  c5: "Field with a darker axis",
}

export const interiorNames: Record<InteriorConcept, string> = {
  plain: "No grid",
  i1: "Strip down the left edge",
  i2: "Strip in the meta column",
  i3: "Header band",
  i4: "Corner registration marks",
}

const box = (x: number, y: number, w: number, h: number, visible = true): Box => ({ x, y, w, h, visible })

/**
 * The cover blocks every concept shares: one logo top left, the title and the form bottom left. The
 * form holds the reference, date and version, so nothing repeats them at the top.
 */
function cover(field: ArchitectLayout["cover"]["field"]): ArchitectLayout["cover"] {
  return {
    field,
    logo: box(15, 15, 10, 12.5),
    // The label and title, one group, halfway between the grid's last row (c3) and the form block's
    // top (the rule line one row above its first rule): about 16mm from the grid's last row to the
    // label's cap top, and from the title's baseline to the form. The box starts below the grid's
    // cutout margin, so the grid keeps its last row.
    title: { ...box(15, 197, 150, 28), size: 34 },
    // The form's rules end at the sheet's horizontal centre (x 105mm on A4).
    form: { ...box(15, 240, page.width / 2 - 15, 42), size: 8 },
  }
}

const covers: Record<CoverConcept, ArchitectLayout["cover"]> = {
  c1: cover({ ...box(0, 0, sheet.a4, 297), pattern: "none", band: "none", bandAt: 0 }),
  c2: cover({ ...box(15, 35, 180, 245), pattern: "none", band: "none", bandAt: 0 }),
  c3: cover({ ...box(0, 0, sheet.a4, 190), pattern: "none", band: "none", bandAt: 0 }),
  c4: cover({ ...box(15, 35, 180, 245), pattern: "o", band: "none", bandAt: 0 }),
  c5: cover({ ...box(15, 35, 180, 245), pattern: "none", band: "column", bandAt: 22 }),
}

const interiors: Record<InteriorConcept, ArchitectLayout["interior"]> = {
  // The default: the architect page system (meta column, numbered sections, running footer) and no grid.
  plain: {
    // 15mm margins left and right, as on the cover: the meta column starts on the logo's left edge,
    // the text column at 54mm, and the footer's centre is the sheet's centre.
    body: box(15, 32, 180, 244),
    meta: { w: 39, inMargin: false },
    grid: { ...box(0, 0, 0, 0, false), kind: "strip" },
    footer: { visible: true },
    opening: 0,
    size: 9,
  },
  i1: {
    body: box(36, 24, 154, 249),
    meta: { w: 26, inMargin: false },
    grid: { ...box(8, 24, 10, 249), kind: "strip" },
    footer: { visible: true },
    opening: 0,
    size: 9,
  },
  i2: {
    body: box(48, 24, 142, 249),
    meta: { w: 0, inMargin: true },
    grid: { ...box(18, 24, 22, 249), kind: "strip" },
    footer: { visible: true },
    opening: 0,
    size: 9,
  },
  i3: {
    body: box(22, 34, 168, 239),
    meta: { w: 34, inMargin: false },
    grid: { ...box(22, 15, 168, 5), kind: "band" },
    footer: { visible: true },
    opening: 0,
    size: 9,
  },
  i4: {
    body: box(24, 26, 166, 245),
    meta: { w: 34, inMargin: false },
    grid: { ...box(24, 26, 166, 245), kind: "marks" },
    footer: { visible: true },
    opening: 0,
    size: 9,
  },
}

export function architectLayout(coverConcept: CoverConcept, interiorConcept: InteriorConcept): ArchitectLayout {
  return structuredClone({ version: 1, cover: covers[coverConcept], interior: interiors[interiorConcept], text: {} })
}

/** The default labels and static text the editor can change. */
export const defaultText = {
  kicker: "OpenCode legal",
  project: "Project",
  number: "Number",
  name: "Name",
  date: "Date",
  versionLabel: "Version",
  sections: "Sections",
  projectValue: "OpenCode",
  headerLeft: "opencode",
}

export type TextKey = keyof typeof defaultText
export const label = (layout: ArchitectLayout, key: TextKey) => layout.text[key] ?? defaultText[key]

/** Where the editor keeps a custom layout; the print style uses it when present. */
export const layoutKey = "opencode-legal-architect-layout-v1"

export function savedLayout(): ArchitectLayout | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(layoutKey) ?? "null")
    return value?.version === 1 && value.cover && value.interior ? value : undefined
  } catch {
    return undefined
  }
}

/** Snaps a value in mm to the square grid. */
export const snap = (value: number) => Math.round(value / module) * module

/** The squares of a field, as SVG markup in mm, centred in the field box. Solid squares form the pattern or band. */
export function fieldSvg(field: ArchitectLayout["cover"]["field"], cutouts: Box[]) {
  // Centred in the field: as many squares as fit across, with the leftover split evenly so the outer
  // squares sit the same distance from both sides; rows start that same distance below the top.
  const across = Math.floor((field.w - square) / module) + 1
  const inset = (field.w - ((across - 1) * module + square)) / 2
  const down = Math.floor((field.h - inset - square) / module) + 1
  const columns = Array.from({ length: Math.max(0, across) }, (_, i) => i)
  const rows = Array.from({ length: Math.max(0, down) }, (_, i) => i)
  const centreX = (c: number) => field.x + inset + square / 2 + c * module
  const centreY = (r: number) => field.y + inset + square / 2 + r * module
  const solid = new Set<string>()
  const glyph = field.pattern === "o" || field.pattern === "c" ? modules[field.pattern] : undefined
  // The glyph sits in the field's upper right, one grid cell per module.
  if (glyph && columns.length && rows.length)
    glyph.forEach((row, y) =>
      [...row].forEach((cell, x) => {
        if (cell === "#") solid.add(`${columns[columns.length - 8 + x]},${rows[3 + y]}`)
      }),
    )
  if (field.pattern === "corner" && columns.length && rows.length)
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
    ].forEach(([x, y]) => solid.add(`${columns[x]},${rows[y]}`))
  const inside = (x: number, y: number) =>
    cutouts.some(
      (cut) => cut.visible && x > cut.x - 2.5 && x < cut.x + cut.w + 2.5 && y > cut.y - 2.5 && y < cut.y + cut.h + 2.5,
    )
  const rects = rows.flatMap((r) =>
    columns.flatMap((c) => {
      const cx = centreX(c)
      const cy = centreY(r)
      if (inside(cx, cy)) return []
      const band = (field.band === "column" && c === field.bandAt) || (field.band === "row" && r === field.bandAt)
      const size = solid.has(`${c},${r}`) ? module * 0.55 : band ? square * 2 : square
      const fill = solid.has(`${c},${r}`) || band ? "#1F1F1F" : "#626262"
      return [
        `<rect x="${(cx - size / 2).toFixed(3)}" y="${(cy - size / 2).toFixed(3)}" width="${size}" height="${size}" fill="${fill}"/>`,
      ]
    }),
  )
  return rects.join("")
}

/** A square grid for the interior margin boxes, as an SVG data URI sized to the box. */
function gridImage(width: number, height: number, area: { x: number; y: number; w: number; h: number }) {
  return `url("${gridSource(width, height, area)}")`
}

/** The square grid in an area of a box, as an SVG data URI (the editor shows it as an image). */
export function gridSource(width: number, height: number, area: { x: number; y: number; w: number; h: number }) {
  const rects: string[] = []
  for (let y = area.y + module / 2; y + square / 2 <= area.y + area.h; y += module)
    for (let x = area.x + module / 2; x + square / 2 <= area.x + area.w; x += module)
      rects.push(
        `<rect x="${(x - square / 2).toFixed(3)}" y="${(y - square / 2).toFixed(3)}" width="${square}" height="${square}" fill="#626262"/>`,
      )
  return svgSource(width, height, rects.join(""))
}

/** Corner marks: a 2 × 2 cluster of squares, set in a corner box at the body's corner. */
function markImage(width: number, height: number, corner: "tl" | "tr" | "bl" | "br") {
  const size = 1.6
  const gap = 1
  const x0 = corner.endsWith("l") ? width - 2 * size - gap - 2 : 2
  const y0 = corner.startsWith("t") ? height - 2 * size - gap - 2 : 2
  const rects = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(
    ([x, y]) =>
      `<rect x="${x0 + x * (size + gap)}" y="${y0 + y * (size + gap)}" width="${size}" height="${size}" fill="#1F1F1F"/>`,
  )
  return svgUri(width, height, rects.join(""))
}

function svgUri(width: number, height: number, body: string) {
  return `url("${svgSource(width, height, body)}")`
}

function svgSource(width: number, height: number, body: string, stretch = false) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"${stretch ? ' preserveAspectRatio="none"' : ""}>${body}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const mm = (value: number) => `${Math.max(0, Math.round(value * 100) / 100)}mm`

/**
 * The cover's element positions and sizes, for any element marked `data-architect-cover`: the
 * printed cover and the layout editor's preview share it. Lower-half elements are bottom-anchored.
 */
export function architectCoverCss(layout: ArchitectLayout) {
  const c = layout.cover
  const parts = (["logo", "title", "form", "field"] as const).map((name) => {
    const item = c[name]
    const bottom = item.y + item.h / 2 > page.height / 2
    // The form block's and the title's edges land on whole CSS pixels (the cover's height is whole
    // pixels too), so their text baselines are painted where the layout puts them.
    const snap = name === "form" || name === "title" ? wholePixels : (value: number) => value
    const y = bottom
      ? `top: auto; bottom: ${mm(snap(page.height - item.y - item.h))};`
      : `top: ${mm(snap(item.y))}; bottom: auto;`
    const left = mm(item.x)
    // The logo is one image from the sheet's corner (logoImage), the same one the interior pages print.
    if (name === "logo")
      return `[data-architect-cover] [data-architect-part="logo"] { left: 0; top: 0; bottom: auto; width: ${mm(logoImage(item).width)}; height: ${mm(logoImage(item).height)}; ${item.visible ? "" : "display: none !important;"} }`
    return `[data-architect-cover] [data-architect-part="${name}"] { left: ${left}; width: ${mm(item.w)}; height: ${mm(snap(item.h))}; ${y} ${item.visible ? "" : "display: none !important;"} }`
  })
  return [
    // Every rule on the cover has the one rule weight.
    `[data-architect-cover] { --title-size: ${c.title.size}pt; --form-size: ${c.form.size}pt; --row: ${formRow}mm; --rule: ${rule}mm; }`,
    ...parts,
    // The field is drawn for the A4 sheet; on US Letter (a shorter page) it moves to stay centred.
    // US Letter is 17.5mm shorter and the title moves up with the bottom edge, so the field is cut
    // (the SVG slices from the top) to whole rows that end nearest 17.5mm higher: 16mm keeps one
    // more row of the 4mm grid than 17.5mm would, and lands closer.
    `@media print and (max-height: 285mm) { [data-architect-cover] [data-architect-part="field"] { left: ${mm(c.field.x + (sheet.letter - sheet.a4) / 2)}; height: ${mm(c.field.y + c.field.h > page.height / 2 ? c.field.h - 16 : c.field.h)}; overflow: hidden; } }`,
  ].join("\n")
}

/**
 * The running footer of every interior page: one row under a rule, the document's name from the
 * text area's left edge, its number and version centred on the sheet, and the page number at the
 * rule's right end. It is @page margin boxes, so it repeats on every page with the right page
 * number and the bottom margin keeps the text clear of it: bottom-left, bottom-center and
 * bottom-right, with the rule as an SVG image in the bottom-left corner box, overflowing to the
 * right under them (CSS borders are rounded to whole pixels in Chromium's print; SVG keeps the
 * exact rule weight).
 */
export type RunningFooter = { title: string; reference: string; page: string; metrics: RowMetrics }

/**
 * Where text sits in a line box of one row, in mm: the value's baseline from the line top, its cap
 * height, and how far to lower the labels so their baselines meet the values'. Measured in the
 * browser once the fonts load (measureFonts in legal-print.tsx); these defaults are Inter's metrics.
 */
export type RowMetrics = { baseline: number; cap: number; shift: number }

/**
 * The running footer's geometry, in mm and pt: its rule `gap` below the text area, then `space` from
 * the rule to the cap top of one row of 19 CSS pixels (about 5mm; whole pixels, like the cover's
 * rows) at 7pt (7/8 of the cover form's type size).
 */
export const running = { gap: 6, space: 3, row: (19 * 25.4) / 96, valueSize: 7 }

/**
 * The top of the rule under row `index` (0-based) of a ruled block, from the block's top: rows are
 * `row` apart and each value sits optically centred between its rules, the same gap from the rule
 * above to its cap top as from its baseline to the rule below: (row − cap − rule) / 2.
 */
export function ruleTop(index: number, row: number, metrics: RowMetrics) {
  return index * row + metrics.baseline + (row - metrics.cap - rule) / 2
}

/** The OpenCode logo mark, ink version, in its 240 × 300 artwork. */
const logoMark = `<path d="M180 240H60V120H180V240Z" fill="#D2D2D2"/><path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="#1F1F1F"/>`

/**
 * The logo mark at its place on the sheet, as one image from the sheet's top-left corner: the cover
 * and the interior pages' top-left margin box both print this, so the logo is in the same place on
 * every sheet. The image is whole CSS pixels (Chromium snaps images to whole pixels) and the mark
 * sits inside it at the exact millimetres.
 */
export function logoImage(logo: Box) {
  const whole = (value: number) => (Math.ceil((value * 96) / 25.4) * 25.4) / 96
  const width = whole(logo.x + logo.w)
  const height = whole(logo.y + logo.h)
  return {
    width,
    height,
    source: svgSource(
      width,
      height,
      `<g transform="translate(${logo.x} ${logo.y}) scale(${logo.w / 240})">${logoMark}</g>`,
    ),
  }
}

/**
 * Where the running footer's line box starts, in mm below the text area's bottom edge. Chromium
 * starts the bottom margin boxes on a whole CSS pixel and paints baselines on whole pixels, so the
 * baseline is moved to the pixel it is painted on and the gap under the rule is the one intended.
 */
export function footerTextTop(metrics: RowMetrics) {
  const baseline = running.gap + rule + running.space + metrics.cap
  return wholePixels(baseline - wholePixels(metrics.baseline))
}

/** Rules for a ruled block as SVG markup in mm, `count` rows of `row`, `width` long. */
export function rulesSvg(count: number, row: number, width: number, metrics: RowMetrics) {
  return Array.from(
    { length: count },
    (_, index) =>
      `<rect x="0" y="${ruleTop(index, row, metrics).toFixed(3)}" width="${width}" height="${rule}" fill="#000"/>`,
  ).join("")
}

/** Default metrics for 7pt Inter in a 5mm row (Inter: ascent 0.969, descent 0.242, cap 0.727 em). */
export function defaultMetrics(size: number, row: number): RowMetrics {
  const em = (size * 25.4) / 72
  return { baseline: (row - 1.211 * em) / 2 + 0.969 * em, cap: 0.727 * em, shift: 0 }
}

/** The dividers inside the document: summary, sections and colophon (Settings › Architect dividers). */
export type Divider = "solid" | "squares" | "dashes" | "double" | "labelled" | "dots"

/** An OpenTUI Mono character cell at the labelled divider's 8.5pt (it advances 0.6em), in mm. */
const cell = 1.8

/**
 * A divider `width` mm long as an SVG image, drawn from its top edge. Repeating patterns are centred,
 * so they end the same distance in from both edges. The image is a whole number of CSS pixels wide
 * and tall (Chromium snaps images to whole pixels and would stretch the pattern).
 */
function dividerImage(kind: Exclude<Divider, "labelled">, width: number) {
  const pixels = (value: number, round: (value: number) => number) => (round((value * 96) / 25.4) * 25.4) / 96
  const w = pixels(width, Math.floor)
  const row = (size: number, pitch: number) => {
    const count = Math.floor((w - size) / pitch) + 1
    const inset = (w - (count - 1) * pitch - size) / 2
    return Array.from({ length: count }, (_, index) => inset + index * pitch)
  }
  const rect = (x: number, y: number, rw: number, rh: number) =>
    `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${rw.toFixed(3)}" height="${rh.toFixed(3)}" fill="#000"/>`
  const shapes = {
    // The cover grid's squares on its pitch.
    squares: () => row(square, module).map((x) => rect(x, 0, square, square)),
    // ╌ in a terminal: two dashes to a mono cell.
    dashes: () => row(cell / 2, cell).map((x) => rect(x, 0, cell / 2, rule)),
    // ═ box drawing: two rules 0.6mm apart.
    double: () => [rect(0, 0, w, rule), rect(0, rule + 0.6, w, rule)],
    // ········ a leader: one small square to a mono cell.
    dots: () => row(rule, cell).map((x) => rect(x, 0, rule, rule)),
    solid: () => [rect(0, 0, w, rule)],
  }
  const height = { squares: square, dashes: rule, double: rule * 2 + 0.6, dots: rule, solid: rule }[kind]
  return `url("${svgSource(w, pixels(height, Math.ceil), shapes[kind]().join(""))}")`
}

/**
 * The print CSS for the dividers. Summary and colophon rules are SVG images at the text column's
 * width (CSS borders print at whole pixels, heavier than the rule weight); every style but solid
 * also draws a divider above each numbered section, across the meta column and the text. The
 * labelled divider is the section heading itself: "─── § 02 Personal data ──────", in OpenTUI Mono on
 * the character cell.
 */
function dividerCss(kind: Divider, layout: ArchitectLayout) {
  const i = layout.interior
  const column = i.body.w - (i.meta.inMargin ? 0 : i.meta.w)
  const plain = kind === "labelled" ? "solid" : kind
  const text = dividerImage(plain, column)
  const blocks = `
    [data-component="legal-summary"] { border-block: 0 !important; padding: 0 !important; }
    [data-component="legal-summary"]::before, [data-component="legal-summary"]::after { content: ${text}; display: block; line-height: 0; }
    [data-component="legal-summary"]::before { margin-bottom: 4mm; }
    [data-component="legal-summary"]::after { margin-top: 4mm; }
    [data-component="legal-print-colophon"] [data-slot="colophon"] { border-top: 0; padding-top: 0; }
    [data-component="legal-print-colophon"] [data-slot="colophon"]::before { content: ${text}; display: block; line-height: 0; margin-bottom: 3mm; }`
  if (kind === "solid" || i.meta.inMargin) return blocks
  if (kind === "labelled") {
    // The rules sit 0.9mm above the baseline, about the middle of the mono lowercase, like ─.
    const line = (width: number, stretch: boolean) =>
      `url("${svgSource(width, 0.9 + rule, `<rect x="0" y="0" width="${width}" height="${rule}" fill="#000"/>`, stretch)}")`
    return `${blocks}
    [data-component="legal-document"] h2 { display: flex !important; align-items: baseline; font-family: var(--mono); font-size: ${((cell / 0.6 / 25.4) * 72).toFixed(3)}pt !important; font-weight: 400 !important; line-height: 1.4; letter-spacing: 0; }
    [data-component="legal-document"] h2::before { content: ${line(cell * 3, false)} "\\00a0§\\00a0" counter(legal-section, decimal-leading-zero) "\\00a0\\00a0" !important; flex: none; padding: 0; margin-left: calc(-1 * var(--edge-shift)); font-size: 1em; white-space: pre; }
    [data-component="legal-document"] h2::after { content: ${line(i.body.w, true)}; flex: 1 1 0; width: 0; min-width: ${cell}mm; height: ${(0.9 + rule).toFixed(4)}mm; margin-left: ${cell}mm; }`
  }
  return `${blocks}
    [data-component="legal-document"] h2::after { content: ${dividerImage(kind, i.body.w)}; display: block; grid-row: 1; grid-column: 1 / -1; line-height: 0; margin-bottom: 4mm; margin-left: calc(-1 * var(--edge-shift)); }
    [data-component="legal-document"] h2::before { grid-row: 2; grid-column: 1; }`
}

/**
 * Chromium's print sheets, in mm: the sheet the PDF has and the width it lays the page out at. Its
 * A4 is 595.92pt wide but laid out 795 CSS pixels wide, about 0.12mm wider, all of it past the
 * right edge; US Letter is 816px both ways.
 */
const sheets = {
  a4: { width: (595.92 * 25.4) / 72, layout: (795 * 25.4) / 96 },
  letter: { width: 215.9, layout: 215.9 },
}

/**
 * OpenTUI Mono's left side bearing on the 8pt section numbers, in mm: the "N" of "No." starts
 * 0.085em in from its box.
 */
const labelBearing = (0.085 * 8 * 25.4) / 72
/** Inter's left side bearing on capitals, in em: between the "P" and the "T" the footer titles start with. */
const sansBearing = 0.064
/** Inter's right side bearing on tabular figures, in em: the page number ends this far in from its box. */
const digitBearing = 0.051

/**
 * The print CSS for a layout: the cover's element positions, the interior's @page margins, the
 * running block and the grid (as SVG images in the margin boxes), for A4 and for the shorter US
 * Letter page.
 */
export function architectCss(layout: ArchitectLayout, footerRow: RunningFooter, divider: Divider = "solid") {
  const c = layout.cover
  const i = layout.interior
  // The text area's edges are the page margins; the bottom margin keeps its size on a shorter page
  // and always leaves room for the running footer.
  // The interior pages carry the cover's logo at the same place, so the text starts a module below it.
  const margin = {
    top: c.logo.visible ? Math.max(i.body.y, c.logo.y + c.logo.h + module) : i.body.y,
    right: page.width - i.body.x - i.body.w,
    bottom: Math.max(running.gap + running.space + running.row + 4, page.height - i.body.y - i.body.h),
    // Chromium clips the page's content at the text area's edge, so the text area starts far enough
    // left of the logo's edge for the section numbers' side bearing, on a whole CSS pixel: their
    // "N" then starts on the logo's left edge.
    left: wholePixels(i.body.x - labelBearing),
  }
  // How far the text area starts left of the logo's edge (negative), and the meta column widened by
  // as much, so the text column stays where the layout puts it.
  const shift = margin.left - i.body.x
  const meta = i.meta.w - shift
  const pageRule = (height: number, sheet: { width: number; layout: number }) => {
    // The right margin is measured on the sheet, so the text area and the footer rule are as far in
    // from the right edge as from the left.
    const m = { ...margin, right: sheet.layout - sheet.width + margin.right }
    const bodyHeight = height - m.top - m.bottom
    const sans = `font-family: "Inter", ui-sans-serif, system-ui, sans-serif; color: #000; font-size: ${running.valueSize}pt; font-variant-numeric: tabular-nums;`
    // The row's cap top sits `running.space` under the rule.
    const top = footerTextTop(footerRow.metrics)
    const row = `white-space: pre; line-height: ${running.row}mm; vertical-align: top; padding: ${top.toFixed(3)}mm 0 0 0; overflow: hidden; text-overflow: ellipsis;`
    const width = sheet.width - i.body.x - margin.right
    // Whole CSS pixels, or Chromium resizes the image to the nearest ones and the rule moves.
    const ruleImage = `url("${svgSource(wholePixels(i.body.x + width + 0.2), wholePixels(running.gap + rule + 0.2), `<rect x="${i.body.x}" y="${running.gap}" width="${width}" height="${rule}" fill="#000"/>`)}")`
    const logo = c.logo.visible
      ? `@top-left-corner { content: url("${logoImage(c.logo).source}"); padding: 0; vertical-align: top; text-align: left; line-height: 0; }`
      : ""
    const footer = i.footer.visible
      ? `@bottom-left-corner { content: ${ruleImage}; padding: 0; vertical-align: top; text-align: left; }
         @bottom-left { content: ${JSON.stringify(footerRow.title)}; ${sans} ${row} text-align: left; text-indent: calc(${(-shift).toFixed(3)}mm - ${sansBearing}em); }
         @bottom-center { content: ${JSON.stringify(footerRow.reference)}; ${sans} ${row} text-align: center; padding-left: ${(-shift).toFixed(3)}mm; }
         @bottom-right { content: ${footerRow.page}; ${sans} ${row} text-align: right; margin-right: -${digitBearing}em; }`
      : ""
    const grid = !i.grid.visible
      ? ""
      : i.grid.kind === "strip"
        ? `@left-middle { content: ${gridImage(m.left, bodyHeight, { x: i.grid.x, y: Math.max(0, i.grid.y - m.top), w: i.grid.w, h: Math.min(bodyHeight, i.grid.h) })}; padding: 0; vertical-align: top; text-align: left; }`
        : i.grid.kind === "band"
          ? `@top-center { content: ${gridImage(page.width - m.left - m.right, m.top, { x: i.grid.x - m.left, y: i.grid.y, w: i.grid.w, h: i.grid.h })}; padding: 0; vertical-align: top; }`
          : (["tl", "tr", "bl", "br"] as const)
              // The top-left corner box carries the logo, the bottom-left one the footer's rule.
              .filter((corner) => !(c.logo.visible && corner === "tl") && !(i.footer.visible && corner.startsWith("b")))
              .map((corner) => {
                const width = corner.endsWith("l") ? m.left : m.right
                const height = corner.startsWith("t") ? m.top : m.bottom
                const name = `${corner.startsWith("t") ? "top" : "bottom"}-${corner.endsWith("l") ? "left" : "right"}-corner`
                return `@${name} { content: ${markImage(width, height, corner)}; padding: 0; vertical-align: top; text-align: left; }`
              })
              .join(" ")
    return `@page { margin: ${mm(m.top)} ${m.right.toFixed(3)}mm ${mm(m.bottom)} ${mm(m.left)}; ${logo} ${footer} ${grid} }
    [data-site]:has([data-legal-print="architect"]) { --edge-shift: ${shift.toFixed(3)}mm; }`
  }
  return `@media print {
  ${pageRule(page.height, sheets.a4)}
  @media (max-height: 285mm) { ${pageRule(279.4, sheets.letter)} }
  @page legal-cover { margin: 0; @top-left { content: none } @top-center { content: none } @top-right { content: none } @bottom-left { content: none } @bottom-center { content: none } @bottom-right { content: none } @left-middle { content: none } @top-left-corner { content: none } @top-right-corner { content: none } @bottom-left-corner { content: none } @bottom-right-corner { content: none } }
  ${architectCoverCss(layout)}
  [data-site]:has([data-legal-print="architect"]) {
    --meta: ${meta.toFixed(3)}mm;
    /* Every rule on the interior pages (tables, summary, colophon) has the one rule weight. */
    --rule: ${rule}mm;
    --rule-heavy: ${rule}mm;
    [data-component="legal-document"], [data-component="legal-summary"], [data-component="legal-print-colophon"] { font-size: ${i.size}pt; }
    [data-component="legal-document"] { padding-left: ${i.meta.inMargin ? "0" : `${meta.toFixed(3)}mm`}; }
    [data-component="legal-summary"], [data-component="legal-print-colophon"] { margin-left: ${i.meta.inMargin ? "0" : `${meta.toFixed(3)}mm`} !important; }
    [data-component="legal-body"] { padding-top: ${mm(i.opening)}; }
    ${
      i.meta.inMargin
        ? `[data-component="legal-document"] h2 { display: block !important; margin-left: 0 !important; } [data-component="legal-document"] h2::before { display: inline; margin-right: 3mm; }`
        : ""
    }
    ${dividerCss(divider, layout)}
  }
}`
}
