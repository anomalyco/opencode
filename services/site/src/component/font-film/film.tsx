import "./film.css"
import { createMemo, For, Index, Show, type JSX } from "solid-js"
import { GlyphShape, layout, type GlyphMode } from "~/component/font/glyph"
import { clamp, ease, span } from "~/component/font/plate"
import {
  anchors,
  buildOrder,
  cellToFont,
  cells,
  contours,
  coverage,
  glyphNames,
  isLetter,
  letters,
  moduleCount,
  modules,
  performance,
  symmetry,
  unicode,
  type Letter,
} from "~/lib/font-content"
import { explodeFactor } from "./motion"
import { cue, fps, shots, shotAt, type CueID } from "./timeline"

export type FilmFormat = "wide" | "tall"
/** How the compromise shot marks a letter the font does not draw. */
export type BoxStyle = "registration" | "brackets" | "modules"

type Shot = (typeof shots)[number]
type Ctx = {
  /** Seconds since the shot's first frame. */
  t: () => number
  /** The shot's length in seconds, for camera moves that span it. */
  length: number
  W: number
  H: number
  tall: boolean
  /** A narration beat, in seconds from the shot's first frame. */
  at: (cue: CueID, beat?: number) => number
  box: BoxStyle
}

const BAR = 60
/** The picture sits inside the letterbox with this margin left and right; the bar labels align with
 * its edges, and copy inside the picture keeps INSET from them. */
const SIDE = 40
const INSET = 40
const tones = {
  dark: {
    "--bg": "#0c0c0c",
    "--ink": "#f2f2f2",
    "--glyph-ink": "#f2f2f2",
    "--shade": "#484848",
    "--glyph-shadow": "#484848",
    "--accent": "#4f8bff",
    "--line": "rgb(242 242 242 / 0.16)",
    "--muted": "rgb(242 242 242 / 0.5)",
  },
  light: {
    "--bg": "#fbfbfb",
    "--ink": "#141414",
    "--glyph-ink": "#141414",
    "--shade": "#cecece",
    "--glyph-shadow": "#cecece",
    "--accent": "#3b5cf6",
    "--line": "rgb(20 20 20 / 0.14)",
    "--muted": "rgb(20 20 20 / 0.5)",
  },
  blue: {
    "--bg": "#3b5cf6",
    "--ink": "#ffffff",
    "--glyph-ink": "#ffffff",
    "--shade": "#8095f9",
    "--glyph-shadow": "#8095f9",
    "--accent": "#0c0c0c",
    "--line": "rgb(255 255 255 / 0.28)",
    "--muted": "rgb(255 255 255 / 0.7)",
  },
} satisfies Record<string, JSX.CSSProperties>
type Tone = keyof typeof tones

/**
 * "OpenCode. Six letters.": the whole film as a pure function of `time`, in seconds. Every frame is
 * SVG built from the font's own outlines and module maps, so a recorder can step it frame by frame.
 * Wide is 1920 × 1080 letterboxed to 2:1; tall is 1080 × 1350 for social.
 */
export function Film(props: {
  time: () => number
  format?: FilmFormat
  box?: BoxStyle
  poster?: "inverted" | "light"
}) {
  const tall = props.format === "tall"
  const outer = tall ? 1080 : 1920
  const W = outer - SIDE * 2
  const full = tall ? 1350 : 1080
  const H = full - BAR * 2
  const shot = createMemo(() => shotAt(props.time()))
  const index = () => shots.indexOf(shot()) + 1
  const ending = () => clamp((props.time() - cue("yours").beats[2]) / 0.8)

  return (
    <div
      data-component="font-film"
      data-format={tall ? "tall" : "wide"}
      style={{ width: `${outer}px`, height: `${full}px` }}
    >
      <div data-slot="film-bar">
        <span>OpenCode Font — The film</span>
        <span>
          {props.poster
            ? "Pl. 00 · The film"
            : `Sc. ${String(index()).padStart(2, "0")}/${shots.length} · ${shot().label}`}
        </span>
      </div>
      <svg
        data-slot="film-frame"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ margin: `0 ${SIDE}px` }}
        shape-rendering="crispEdges"
      >
        <Show when={!props.poster && shot()} keyed>
          {(item) => <Scene shot={item} c={context(item)} />}
        </Show>
        <Show when={props.poster}>{(tone) => <PosterScene tone={tone()} c={context(shots[0])} />}</Show>
      </svg>
      <div data-slot="film-bar">
        <span>TC {timecode(props.time())}</span>
        <span>opencode.ai/font</span>
      </div>
      {/* The ending: the whole frame, bars included, fades to black under "yours alone" and stays black. */}
      <Show when={!props.poster && ending() > 0}>
        <div data-slot="film-fade" style={{ opacity: ending() }} />
      </Show>
    </div>
  )

  function context(item: Shot): Ctx {
    return {
      t: () => props.time() - item.start,
      length: item.end - item.start,
      W,
      H,
      tall,
      at: (id, beat = 0) => cue(id).beats[beat] - item.start,
      box: props.box ?? "registration",
    }
  }
}

function Scene(props: { shot: Shot; c: Ctx }) {
  const scenes = {
    module: ModuleScene,
    grid: GridScene,
    alphabet: AlphabetScene,
    letters: LettersScene,
    parade: ParadeScene,
    compromise: CompromiseScene,
    curves: CurvesScene,
    plotter: PlotterScene,
    measure: MeasureScene,
    loupe: LoupeScene,
    kerning: KerningScene,
    exploded: ExplodedScene,
    bytes: BytesScene,
    thousands: ThousandsScene,
    terminal: TerminalScene,
    variants: VariantsScene,
    yours: YoursScene,
  }
  const Component = scenes[props.shot.id]
  return <Component c={props.c} />
}

/* ───────────────────────── Shared pieces ───────────────────────── */

function Stage(props: { tone: Tone; c: Ctx; children: JSX.Element; push?: [number, number]; at?: [number, number] }) {
  const transform = () => {
    if (!props.push) return undefined
    const [from, to] = props.push
    const [cx, cy] = props.at ?? [props.c.W / 2, props.c.H / 2]
    const scale = from + (to - from) * ease.inOut(props.c.t() / props.c.length)
    return `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`
  }
  return (
    <g style={tones[props.tone]}>
      <rect width={props.c.W} height={props.c.H} fill="var(--bg)" />
      <g transform={transform()}>{props.children}</g>
    </g>
  )
}

function Glyph(props: { letter: Letter; x: number; y: number; m: number; mode?: GlyphMode; opacity?: number }) {
  return (
    <g transform={`translate(${props.x} ${props.y}) scale(${props.m / 6})`} opacity={props.opacity}>
      <GlyphShape letter={props.letter} mode={props.mode} />
    </g>
  )
}

function Mono(props: {
  x: number
  y: number
  size?: number
  anchor?: "start" | "middle" | "end"
  fill?: string
  opacity?: number
  children: JSX.Element
}) {
  return (
    <text
      data-type="mono"
      x={props.x}
      y={props.y}
      font-size={String(props.size ?? 18)}
      text-anchor={props.anchor ?? "start"}
      fill={props.fill ?? "var(--muted)"}
      opacity={props.opacity}
    >
      {props.children}
    </text>
  )
}

/** The wordmark's rows for this format: one line wide, two lines tall. */
function wordRows(text: string, c: Ctx, split: number) {
  return c.tall ? [text.slice(0, split), text.slice(split)] : [text]
}

/** Lays out rows of text in cell units at module size `m`, centred in the frame. */
function placeRows(rows: string[], c: Ctx, fill = 0.86, maxM = 999) {
  const cols = Math.max(...rows.map((row) => layout(row).width / 6))
  const tall = rows.length * 7 + (rows.length - 1) * 2
  const m = Math.min(maxM, Math.floor(Math.min((c.W * fill) / cols, (c.H * 0.8) / tall)))
  const oy = Math.round((c.H - tall * m) / 2)
  return {
    m,
    items: rows.flatMap((row, r) => {
      const shape = layout(row)
      const ox = Math.round((c.W - (shape.width / 6) * m) / 2)
      return shape.items.map((item) => ({
        ...item,
        px: ox + (item.x / 6) * m,
        py: oy + r * 9 * m,
      }))
    }),
    ox: Math.round((c.W - cols * m) / 2),
    oy,
    cols,
    rows: tall,
  }
}

const fmt = (value: number) => Math.round(value).toLocaleString("en-US")
const pad = (value: number, length = 2) => String(value).padStart(length, "0")

function timecode(time: number) {
  const frame = Math.round(time * fps)
  return `${pad(Math.floor(frame / (fps * 3600)))}:${pad(Math.floor(frame / (fps * 60)) % 60)}:${pad(Math.floor(frame / fps) % 60)}:${pad(frame % fps)}`
}

/** A stable pseudo-random number in [0, 1) for an integer seed. */
function hash(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

/* ───────────────────────── 01 One module ───────────────────────── */

function ModuleScene(props: { c: Ctx }) {
  const c = props.c
  const S = Math.round((Math.min(c.W, c.H) * 0.34) / 12) * 12
  const x0 = Math.round(c.W / 2 - S / 2)
  const y0 = Math.round(c.H / 2 - S / 2)
  const draw = () => span(c.t(), c.at("square") - 0.15, 1.1)
  const filled = () => c.t() > c.at("square") + 1.25
  const dims = () => ease.outExpo(span(c.t(), c.at("units"), 0.7))
  const pen = () => {
    const d = draw() * 4 * S
    if (d < S) return [x0 + d, y0]
    if (d < 2 * S) return [x0 + S, y0 + d - S]
    if (d < 3 * S) return [x0 + S - (d - 2 * S), y0 + S]
    return [x0, y0 + S - (d - 3 * S)]
  }
  const lines = Array.from({ length: Math.ceil(c.W / S) + 2 }, (_, k) => x0 + (k - Math.ceil(x0 / S)) * S)
  const rows = Array.from({ length: Math.ceil(c.H / S) + 2 }, (_, k) => y0 + (k - Math.ceil(y0 / S)) * S)

  return (
    <Stage tone="dark" c={c} push={[1, 1.14]}>
      <g opacity={dims() * 0.8} stroke="var(--line)" stroke-width="1">
        <For each={lines}>{(x) => <line x1={x} x2={x} y1={0} y2={c.H} />}</For>
        <For each={rows}>{(y) => <line y1={y} y2={y} x1={0} x2={c.W} />}</For>
      </g>
      <Show when={filled()}>
        <rect x={x0} y={y0} width={S} height={S} fill="var(--ink)" />
      </Show>
      <rect
        x={x0}
        y={y0}
        width={S}
        height={S}
        fill="none"
        stroke="var(--ink)"
        stroke-width="2"
        stroke-dasharray={`${4 * S}`}
        stroke-dashoffset={4 * S * (1 - draw())}
        shape-rendering="geometricPrecision"
      />
      <Show when={draw() > 0 && draw() < 1}>
        <PenHead x={pen()[0]} y={pen()[1]} />
      </Show>
      <g opacity={dims()} stroke="var(--accent)" stroke-width="2">
        <line x1={x0} x2={x0 + S * dims()} y1={y0 - 36} y2={y0 - 36} />
        <line x1={x0} x2={x0} y1={y0 - 46} y2={y0 - 26} />
        <line x1={x0 + S * dims()} x2={x0 + S * dims()} y1={y0 - 46} y2={y0 - 26} />
        <line x1={x0 + S + 36} x2={x0 + S + 36} y1={y0} y2={y0 + S * dims()} />
        <line x1={x0 + S + 26} x2={x0 + S + 46} y1={y0} y2={y0} />
        <line x1={x0 + S + 26} x2={x0 + S + 46} y1={y0 + S * dims()} y2={y0 + S * dims()} />
      </g>
      <g opacity={dims()}>
        <Mono x={x0 + S / 2} y={y0 - 60} size={26} anchor="middle" fill="var(--ink)">
          120{c.t() > c.at("units", 1) ? " +0" : ""}
          {c.t() > c.at("units", 2) ? " −0" : ""}
        </Mono>
        <Mono x={x0 + S + 62} y={y0 + S / 2 + 9} size={26} fill="var(--ink)">
          120
        </Mono>
        <Mono x={x0 + S / 2} y={y0 + S + 64} size={18} anchor="middle">
          1 MODULE = 120 × 120 UNITS
        </Mono>
      </g>
    </Stage>
  )
}

function PenHead(props: { x: number; y: number }) {
  return (
    <g transform={`translate(${Math.round(props.x)} ${Math.round(props.y)})`}>
      <rect x="-7" y="-7" width="14" height="14" fill="var(--accent)" />
      <line x1="-22" x2="22" y1="0" y2="0" stroke="var(--accent)" stroke-width="1" />
      <line y1="-22" y2="22" x1="0" x2="0" stroke="var(--accent)" stroke-width="1" />
    </g>
  )
}

/* ───────────────────────── 02 The grid ───────────────────────── */

function GridScene(props: { c: Ctx }) {
  const c = props.c
  const word = placeRows(wordRows("opencode", c, 4), c, 0.86)
  const m = word.m
  const lock = c.at("grid", 1)
  const verticals = Array.from({ length: Math.ceil(c.W / m) + 1 }, (_, k) => word.ox + (k - Math.ceil(word.ox / m)) * m)
  const horizontals = Array.from(
    { length: Math.ceil(c.H / m) + 1 },
    (_, k) => word.oy + (k - Math.ceil(word.oy / m)) * m,
  )
  const placed = word.items.flatMap((item, li) => {
    if (!item.letter) return []
    const letter = item.letter
    const ink = buildOrder(letter)
    const shade = cells(letter, "+")
    return [
      ...ink.map((cell, i) => ({ cell, tone: "ink", at: 0.45 + li * 0.09 + i * 0.06, px: item.px, py: item.py })),
      ...shade.map((cell, i) => ({
        cell,
        tone: "shade",
        at: 0.45 + li * 0.09 + (ink.length + i) * 0.06,
        px: item.px,
        py: item.py,
      })),
    ]
  })
  const lineDraw = (offset: number) => ease.out(span(c.t(), 0.02 + offset * 0.004, 0.45))
  const locked = () => c.t() >= lock

  return (
    <Stage tone="light" c={c}>
      <g stroke="var(--line)" stroke-width="1" opacity={locked() ? 0.55 : 1}>
        <For each={verticals}>
          {(x) => {
            const offset = Math.abs(x - c.W / 2) / m
            return (
              <line
                x1={x}
                x2={x}
                y1={c.H / 2 - (c.H / 2) * lineDraw(offset)}
                y2={c.H / 2 + (c.H / 2) * lineDraw(offset)}
              />
            )
          }}
        </For>
        <For each={horizontals}>
          {(y) => {
            const offset = Math.abs(y - c.H / 2) / m
            return (
              <line
                y1={y}
                y2={y}
                x1={c.W / 2 - (c.W / 2) * lineDraw(offset)}
                x2={c.W / 2 + (c.W / 2) * lineDraw(offset)}
              />
            )
          }}
        </For>
      </g>
      <For each={placed}>
        {(item) => (
          <Show when={c.t() >= item.at}>
            <rect
              x={item.px + item.cell[0] * m}
              y={item.py + item.cell[1] * m}
              width={m}
              height={m}
              fill={item.tone === "ink" ? "var(--ink)" : "var(--shade)"}
            />
          </Show>
        )}
      </For>
      <Show when={locked()}>
        <Mono x={c.W / 2} y={c.H - 48} size={18} anchor="middle" fill="var(--accent)">
          GRID 120 U · TOLERANCE 0 U · EXCEPTIONS 0
        </Mono>
      </Show>
    </Stage>
  )
}

/* ───────────────────────── 03 Twenty-six, minus twenty ───────────────────────── */

function AlphabetScene(props: { c: Ctx }) {
  const c = props.c
  const alphabet = [..."abcdefghijklmnopqrstuvwxyz"]
  const cols = c.tall ? 7 : 13
  const cw = Math.floor((c.W * 0.84) / cols)
  const size = Math.round(cw * 1.3)
  const rowH = Math.round(size * 1.2)
  const rows = Math.ceil(alphabet.length / cols)
  const ox = (c.W - cols * cw) / 2
  const oy = (c.H - rows * rowH) / 2 - 30
  const cut = c.at("six", 1)
  const others = alphabet.filter((char) => !isLetter(char))
  const struck = (char: string) => {
    const index = others.indexOf(char)
    return index >= 0 && c.t() >= cut + index * 0.035
  }
  const count = () => 26 - others.filter((char) => struck(char)).length

  return (
    <Stage tone="dark" c={c}>
      <For each={alphabet}>
        {(char, i) => {
          const x = ox + (i() % cols) * cw + cw / 2
          const y = oy + Math.floor(i() / cols) * rowH + rowH * 0.78
          const keep = isLetter(char)
          return (
            <Show when={c.t() >= i() * 0.028}>
              <g opacity={struck(char) ? 0.16 : 1}>
                <text
                  data-type="mono"
                  x={x}
                  y={y}
                  font-size={String(size)}
                  text-anchor="middle"
                  fill={keep && c.t() >= cut + 0.75 ? "var(--accent)" : "var(--ink)"}
                >
                  {char}
                </text>
                <Show when={struck(char)}>
                  <line
                    x1={x - cw * 0.42}
                    x2={x + cw * 0.42}
                    y1={y - size * 0.28}
                    y2={y - size * 0.28}
                    stroke="var(--ink)"
                    stroke-width="3"
                  />
                </Show>
              </g>
            </Show>
          )
        }}
      </For>
      <Mono x={c.W / 2} y={oy + rows * rowH + 90} size={34} anchor="middle" fill="var(--ink)">
        GLYPHS {pad(count())}
      </Mono>
    </Stage>
  )
}

/* ───────────────────────── 04 O. P. E. N. C. D. ───────────────────────── */

function LettersScene(props: { c: Ctx }) {
  const c = props.c
  const cycle: Tone[] = ["light", "dark", "blue", "light", "dark", "blue"]
  const beats = cue("letters").beats.map((_, i) => c.at("letters", i))
  const index = () => Math.max(0, beats.filter((beat) => c.t() >= beat - 0.12).length - 1)
  const m = Math.floor(Math.min((c.H * 0.84) / 7, c.tall ? (c.W * 0.4) / 4 : Infinity))
  const gx = c.tall ? INSET : Math.round(c.W * 0.14)
  const gy = Math.round((c.H - 7 * m) / 2)
  const tx = c.tall ? gx + 4 * m + 56 : Math.round(c.W * 0.52)
  // The text block: font size and baseline of each line. The numeral sits at the same place for every
  // letter, its cap height centred on the x-height box (rows 1–5, which all six letters share); the
  // lines below hang from it and grow downward.
  const block = c.tall
    ? { sizes: [150, 24, 22, 20, 20, 20], baselines: [0, 58, 94, 128, 158, 188] }
    : { sizes: [220, 28, 22, 22], baselines: [0, 70, 116, 152] }
  const numeral = Math.round(gy + 3.5 * m + (block.sizes[0] * 0.72) / 2)
  const lines = (letter: Letter, i: number) =>
    c.tall
      ? [
          pad(i + 1),
          unicode(letter),
          glyphNames[letter].toUpperCase(),
          `INK ${moduleCount(letter, "#")} · SHADE ${moduleCount(letter, "+")}`,
          `COVERAGE ${(coverage(letter) * 100).toFixed(1)}%`,
          `${i + 1} OF 6`,
        ]
      : [
          pad(i + 1),
          `${unicode(letter)} · ${glyphNames[letter].toUpperCase()}`,
          `INK ${moduleCount(letter, "#")} · SHADE ${moduleCount(letter, "+")} · COVERAGE ${(coverage(letter) * 100).toFixed(1)}%`,
          `${i + 1} OF 6`,
        ]

  return (
    <Index each={letters}>
      {(letter, i) => (
        <Show when={index() === i}>
          <Stage tone={cycle[i]} c={c}>
            <Glyph letter={letter()} x={gx} y={gy} m={m} />
            <For each={lines(letter(), i)}>
              {(line, k) => (
                <Mono
                  x={k() === 0 ? tx : tx + 8}
                  y={numeral + block.baselines[k()]}
                  size={block.sizes[k()]}
                  fill={k() < 2 ? "var(--ink)" : undefined}
                >
                  {line}
                </Mono>
              )}
            </For>
          </Stage>
        </Show>
      )}
    </Index>
  )
}

/* ───────────────────────── 05 The wordmark, sliding past ───────────────────────── */

function ParadeScene(props: { c: Ctx }) {
  const c = props.c
  const m = Math.round(c.H * (c.tall ? 0.12 : 0.165))
  const pitch = 5 * m
  const speed = c.tall ? 900 : 1500
  const run = [..."opencodeopencode"] as Letter[]

  return (
    <Stage tone="dark" c={c}>
      <For each={run}>
        {(letter, i) => (
          <Glyph
            letter={letter}
            x={Math.round(c.W * 0.55 + i() * pitch - c.t() * speed)}
            y={Math.round(c.H / 2 - 3.5 * m)}
            m={m}
          />
        )}
      </For>
    </Stage>
  )
}

/* ───────────────────────── 06 Compromise ───────────────────────── */

function CompromiseScene(props: { c: Ctx }) {
  const c = props.c
  const word = placeRows(wordRows("compromise", c, 6), c, 0.9)
  const m = word.m
  const reveal = c.at("wordmark", 2)
  const missing = word.items.filter((item) => !item.letter)
  // The letter fills the x-height box: OpenTUI Mono's x-height is 0.52 em.
  const size = Math.round((m * 2.6) / 0.52)

  return (
    <Stage tone="light" c={c}>
      <For each={word.items}>
        {(item) => (
          <Show
            when={item.letter}
            fallback={
              <Show when={c.t() >= reveal + missing.indexOf(item) * 0.12}>
                <GhostCell x={item.px} y={item.py} m={m} style={c.box} />
                <text
                  data-type="mono"
                  x={item.px + 2 * m}
                  y={Math.round(item.py + 3.5 * m + size * 0.26)}
                  font-size={String(size)}
                  text-anchor="middle"
                  fill="var(--accent)"
                >
                  {item.char}
                </text>
              </Show>
            }
          >
            {(letter) => <Glyph letter={letter()} x={item.px} y={item.py} m={m} />}
          </Show>
        )}
      </For>
      <Show when={c.t() >= reveal + 0.7}>
        <Mono x={c.W / 2} y={c.H - 56} size={20} anchor="middle" fill="var(--ink)">
          4 OF 10 LETTERS UNNECESSARY
        </Mono>
      </Show>
    </Stage>
  )
}

/**
 * An empty letter cell, in one of three treatments, drawn in 1px lines snapped to the pixel grid.
 * The box is the x-height (rows 1–5) of a 4 × 7 cell at module size `m`, origin (x, y).
 */
function GhostCell(props: { x: number; y: number; m: number; style: BoxStyle }) {
  const left = Math.round(props.x) + 0.5
  const top = Math.round(props.y + props.m) + 0.5
  const right = Math.round(props.x + 4 * props.m) - 0.5
  const bottom = Math.round(props.y + 6 * props.m) - 0.5
  const arm = 8
  // Whole dashes on each side, ending the same distance before each corner mark.
  const dashes = (from: number, to: number) => {
    const clear = arm + 6
    const length = to - from - clear * 2
    const dash = 6
    const count = Math.max(1, Math.round((length + dash) / (dash * 2)))
    const gap = count > 1 ? (length - count * dash) / (count - 1) : 0
    return Array.from({ length: count }, (_, i) => {
      const start = Math.round(from + clear + i * (dash + gap))
      return [start, start + dash] as const
    })
  }

  return (
    <g stroke="var(--accent)" stroke-width="1" fill="none">
      <Show when={props.style === "registration"}>
        <For
          each={
            [
              [left, top],
              [right, top],
              [left, bottom],
              [right, bottom],
            ] as const
          }
        >
          {([x, y]) => (
            <>
              <line x1={x - arm} x2={x + arm + 1} y1={y} y2={y} />
              <line x1={x} x2={x} y1={y - arm} y2={y + arm + 1} />
            </>
          )}
        </For>
        <For each={dashes(left, right)}>
          {([a, b]) => (
            <>
              <line x1={a} x2={b} y1={top} y2={top} />
              <line x1={a} x2={b} y1={bottom} y2={bottom} />
            </>
          )}
        </For>
        <For each={dashes(top, bottom)}>
          {([a, b]) => (
            <>
              <line x1={left} x2={left} y1={a} y2={b} />
              <line x1={right} x2={right} y1={a} y2={b} />
            </>
          )}
        </For>
      </Show>
      <Show when={props.style === "brackets"}>
        <For
          each={
            [
              [left, top, 1, 1],
              [right, top, -1, 1],
              [left, bottom, 1, -1],
              [right, bottom, -1, -1],
            ] as const
          }
        >
          {([x, y, dx, dy]) => <path d={`M${x + dx * 16} ${y}H${x}V${y + dy * 16}`} />}
        </For>
      </Show>
      <Show when={props.style === "modules"}>
        <For each={Array.from({ length: 28 }, (_, i) => [i % 4, Math.floor(i / 4)] as const)}>
          {([col, row]) => (
            <rect
              x={Math.round(props.x + (col + 0.5) * props.m) - 1.5}
              y={Math.round(props.y + (row + 0.5) * props.m) - 1.5}
              width="3"
              height="3"
              fill="var(--accent)"
              stroke="none"
            />
          )}
        </For>
      </Show>
    </g>
  )
}

/* ───────────────────────── 07 No curves, no diagonals ───────────────────────── */

function CurvesScene(props: { c: Ctx }) {
  const c = props.c
  // Both figures share one box of 8 × 8 cells, one cell size, one top and bottom. The title sits a
  // full cell above the box and the count a full cell below it.
  const N = 8
  const cell = Math.floor(Math.min(c.tall ? c.W * 0.5 : c.W * 0.24, c.tall ? c.H * 0.3 : c.H * 0.5) / N)
  const B = cell * N
  const titleGap = cell + 6
  const block = 18 + titleGap + B + cell + 22
  const centres = c.tall
    ? [
        [c.W / 2, c.H * 0.25],
        [c.W / 2, c.H * 0.75],
      ]
    : [
        [c.W * 0.3, c.H / 2],
        [c.W * 0.7, c.H / 2],
      ]
  const boxes = centres.map(([cx, cy]) => {
    const x = Math.round(cx - B / 2)
    const y = Math.round(cy - block / 2 + 18 + titleGap)
    return { x, y, cx: x + B / 2, cy: y + B / 2 }
  })
  const [a, b] = boxes
  const r = 3.5 * cell
  const ring = Array.from({ length: N * N }, (_, i) => [i % N, Math.floor(i / N)] as const).filter(
    ([x, y]) => Math.abs(Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) * cell - r) < cell * 0.55,
  )
  const mo = Math.floor(B / 5 / 2) * 2
  const curve = () => span(c.t(), c.at("curves") - 0.05, 0.8)
  const quantize = c.at("curves", 1)
  const diagonal = () => span(c.t(), c.at("diagonals") - 0.05, 0.6)
  const stairs = c.at("diagonals", 1)

  return (
    <Stage tone="light" c={c}>
      <Mono x={a.x} y={a.y - titleGap} size={18}>
        FIG. 1 — CURVE
      </Mono>
      <Show when={c.t() < quantize + 0.55}>
        <circle
          cx={a.cx}
          cy={a.cy}
          r={r}
          fill="none"
          stroke="var(--ink)"
          stroke-width="2"
          stroke-dasharray={`${2 * Math.PI * r}`}
          stroke-dashoffset={2 * Math.PI * r * (1 - curve())}
          opacity={c.t() >= quantize ? 0.25 : 1}
          transform={`rotate(-90 ${a.cx} ${a.cy})`}
          shape-rendering="geometricPrecision"
        />
        <Show when={curve() > 0 && curve() < 1}>
          <PenHead
            x={a.cx + Math.cos(curve() * 2 * Math.PI - Math.PI / 2) * r}
            y={a.cy + Math.sin(curve() * 2 * Math.PI - Math.PI / 2) * r}
          />
        </Show>
        <Show when={c.t() >= quantize}>
          <For each={ring}>
            {([x, y]) => <rect x={a.x + x * cell} y={a.y + y * cell} width={cell} height={cell} fill="var(--accent)" />}
          </For>
        </Show>
      </Show>
      <Show when={c.t() >= quantize + 0.55}>
        <Glyph letter="o" x={Math.round(a.cx - 2 * mo)} y={Math.round(a.cy - 3.5 * mo)} m={mo} />
        <Mono x={a.cx} y={a.y + B + cell + 22} size={22} anchor="middle" fill="var(--ink)">
          CURVES: 0
        </Mono>
      </Show>

      <Show when={c.t() >= c.at("diagonals") - 0.12}>
        <Mono x={b.x} y={b.y - titleGap} size={18}>
          FIG. 2 — DIAGONAL
        </Mono>
        <line
          x1={b.x}
          y1={b.y + B}
          x2={b.x + B * diagonal()}
          y2={b.y + B - B * diagonal()}
          stroke="var(--ink)"
          stroke-width="2"
          opacity={c.t() >= stairs ? 0.25 : 1}
          shape-rendering="geometricPrecision"
        />
        <Show when={diagonal() > 0 && diagonal() < 1}>
          <PenHead x={b.x + B * diagonal()} y={b.y + B - B * diagonal()} />
        </Show>
        <For each={Array.from({ length: N }, (_, i) => i)}>
          {(i) => (
            <Show when={c.t() >= stairs + i * 0.05}>
              <rect x={b.x + i * cell} y={b.y + B - (i + 1) * cell} width={cell} height={cell} fill="var(--ink)" />
            </Show>
          )}
        </For>
        <Show when={c.t() >= stairs + 0.4}>
          <Mono x={b.cx} y={b.y + B + cell + 22} size={22} anchor="middle" fill="var(--ink)">
            DIAGONALS: 0
          </Mono>
        </Show>
      </Show>
    </Stage>
  )
}

/* ───────────────────────── 08 Pen plotter ───────────────────────── */

function PlotterScene(props: { c: Ctx }) {
  const c = props.c
  const letter: Letter = "e"
  const m = Math.floor((c.H * (c.tall ? 0.6 : 0.8)) / 7)
  const gx = c.tall ? Math.round((c.W - 4 * m) / 2) : Math.round(c.W * 0.2)
  const gy = c.tall ? 50 : Math.round((c.H - 7 * m) / 2)
  const X = (x: number) => gx + (x / 6) * m
  const Y = (y: number) => gy + (y / 6) * m
  const paths = contours(letter).map((points) => [...points, points[0]])
  const lengths = paths.map((points) =>
    points
      .slice(1)
      .reduce((sum, point, i) => sum + Math.abs(point[0] - points[i][0]) + Math.abs(point[1] - points[i][1]), 0),
  )
  const total = lengths.reduce((sum, value) => sum + value, 0)
  const corners = anchors(letter).length
  const progress = () => span(c.t(), 0.2, c.at("edges", 1) - 0.25) * total
  const fill = c.at("edges", 1)

  const trace = createMemo(() => {
    let left = progress()
    let pen: [number, number] = paths[0][0]
    let segment = 0
    let heading = 0
    const reached: [number, number][] = []
    const drawn = paths.map((points) => {
      if (left <= 0) return ""
      let d = `M${X(points[0][0])} ${Y(points[0][1])}`
      reached.push(points[0])
      pen = points[0]
      for (let i = 1; i < points.length && left > 0; i++) {
        const from = points[i - 1]
        const to = points[i]
        const length = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1])
        const part = Math.min(1, left / length)
        left -= length
        segment++
        heading = to[0] > from[0] ? 0 : to[0] < from[0] ? 180 : to[1] > from[1] ? 270 : 90
        pen = [from[0] + (to[0] - from[0]) * part, from[1] + (to[1] - from[1]) * part]
        d += ` L${X(pen[0])} ${Y(pen[1])}`
        if (part === 1 && i < points.length - 1) reached.push(to)
      }
      return d
    })
    return { drawn, pen, segment, heading, reached }
  })
  const readout = () => cellToFont(trace().pen[0], trace().pen[1])
  const rx = c.tall ? INSET : Math.round(c.W * 0.58)
  const ry = c.tall ? gy + 7 * m + 60 : Math.round(c.H * 0.32)

  return (
    <Stage tone="blue" c={c}>
      <g stroke="var(--line)" stroke-width="1">
        <For each={Array.from({ length: 25 }, (_, i) => i)}>
          {(i) => <line x1={X(i)} x2={X(i)} y1={gy} y2={gy + 7 * m} opacity={i % 6 === 0 ? 1 : 0.3} />}
        </For>
        <For each={Array.from({ length: 43 }, (_, i) => i)}>
          {(i) => <line y1={Y(i)} y2={Y(i)} x1={gx} x2={gx + 4 * m} opacity={i % 6 === 0 ? 1 : 0.3} />}
        </For>
      </g>
      {/* The finished letter: translucent white, so the blue grid still shows through it. */}
      <Show when={c.t() >= fill}>
        <g style={{ "--glyph-ink": "rgb(255 255 255 / 0.82)", "--glyph-shadow": "rgb(255 255 255 / 0.32)" }}>
          <Glyph letter={letter} x={gx} y={gy} m={m} />
        </g>
      </Show>
      <g fill="none" stroke="var(--ink)" stroke-width="3" stroke-linejoin="miter">
        <For each={trace().drawn}>{(d) => <path d={d} />}</For>
      </g>
      <For each={trace().reached}>
        {(point) => (
          <>
            <rect x={X(point[0]) - 5} y={Y(point[1]) - 5} width="10" height="10" fill="var(--ink)" />
            <Mono x={X(point[0]) + 10} y={Y(point[1]) - 10} size={14} fill="var(--ink)">
              {cellToFont(point[0], point[1]).join(",")}
            </Mono>
          </>
        )}
      </For>
      <Show when={c.t() < fill}>
        <g stroke="var(--ink)" stroke-width="1" opacity="0.45">
          <line x1={X(trace().pen[0])} x2={X(trace().pen[0])} y1={0} y2={c.H} />
          <line y1={Y(trace().pen[1])} y2={Y(trace().pen[1])} x1={0} x2={c.W} />
        </g>
        <rect x={X(trace().pen[0]) - 18} y={0} width="36" height="14" fill="var(--ink)" />
        <PenHead x={X(trace().pen[0])} y={Y(trace().pen[1])} />
      </Show>
      <Mono x={rx} y={ry} size={22} fill="var(--ink)">
        PLOTTER · OUTLINE OF e
      </Mono>
      <Mono x={rx} y={ry + 52} size={44} fill="var(--ink)">
        X {pad(readout()[0], 4)} Y {pad(readout()[1], 4)}
      </Mono>
      <Mono x={rx} y={ry + 100} size={22}>
        SEGMENT {pad(trace().segment)} · HEADING {pad(trace().heading, 3)}°
      </Mono>
      <Mono x={rx} y={ry + 136} size={22}>
        CURVES 0 · DIAGONALS 0
      </Mono>
      <Show when={c.t() >= fill}>
        <Mono x={rx} y={ry + 188} size={22} fill="var(--ink)">
          {corners} OF {corners} CORNERS ON A WHOLE MODULE
        </Mono>
      </Show>
    </Stage>
  )
}

/* ───────────────────────── 09 Symmetry, ink, shade ───────────────────────── */

function MeasureScene(props: { c: Ctx }) {
  const c = props.c
  const gap = 36
  const panels = [0, 1, 2].map((i) => {
    if (c.tall) {
      const h = (c.H - 80 - gap * 2) / 3
      return { x: 60, y: 40 + i * (h + gap), w: c.W - 120, h }
    }
    const w = (c.W - 160 - gap * 2) / 3
    return { x: 80 + i * (w + gap), y: 70, w, h: c.H - 140 }
  })
  const starts = [0, c.at("measure", 2), c.at("measure", 4)]
  const stamps = [c.at("measure", 1), c.at("measure", 3), c.at("measure", 5)]
  const titles = ["01 SYMMETRY", "02 INK COVERAGE", "03 SHADE"]
  const words = ["MEASURED", "COUNTED", "CALIBRATED"]
  const items = (box: (typeof panels)[number]) => {
    const cols = c.tall ? 6 : 2
    const rows = c.tall ? 1 : 3
    const scale = Math.min(box.w / cols / 230, (box.h - 50) / rows / 220)
    return letters.map((letter, i) => ({
      letter,
      transform: `translate(${box.x + (i % cols) * (box.w / cols)} ${box.y + 50 + Math.floor(i / cols) * ((box.h - 50) / rows)}) scale(${scale})`,
    }))
  }

  return (
    <Stage tone="light" c={c}>
      <Index each={panels}>
        {(box, p) => (
          <Show when={c.t() >= starts[p] - 0.05}>
            <line
              x1={box().x}
              x2={box().x + box().w}
              y1={box().y + 14}
              y2={box().y + 14}
              stroke="var(--ink)"
              stroke-width="1"
            />
            <Mono x={box().x} y={box().y} size={18} fill="var(--ink)">
              {titles[p]}
            </Mono>
            <Show when={c.t() >= stamps[p]}>
              <Mono x={box().x + box().w} y={box().y} size={18} anchor="end" fill="var(--accent)">
                {words[p]}
              </Mono>
            </Show>
            <For each={items(box())}>
              {(item) => (
                <g transform={item.transform}>
                  {p === 0 && (
                    <SymmetryItem letter={item.letter} grow={ease.outExpo(span(c.t(), starts[0] + 0.1, 0.8))} />
                  )}
                  {p === 1 && <CoverageItem letter={item.letter} time={c.t() - starts[1]} />}
                  {p === 2 && <ShadeItem letter={item.letter} time={c.t() - starts[2]} />}
                </g>
              )}
            </For>
          </Show>
        )}
      </Index>
    </Stage>
  )
}

function SymmetryItem(props: { letter: Letter; grow: number }) {
  const v = symmetry(props.letter, "vertical")
  const h = symmetry(props.letter, "horizontal")
  return (
    <>
      <Glyph letter={props.letter} x={0} y={0} m={8} />
      <For
        each={
          [
            ["V", v, 96],
            ["H", h, 150],
          ] as const
        }
      >
        {([label, value, y]) => (
          <>
            <Mono x={0} y={y - 10} size={18}>
              {label}
            </Mono>
            <Mono x={200} y={y - 10} size={18} anchor="end" fill="var(--ink)">
              {Math.round(value * 100 * props.grow)}%
            </Mono>
            <rect x={0} y={y} width={200} height={14} fill="var(--shade)" opacity="0.5" />
            <rect x={0} y={y} width={200 * value * props.grow} height={14} fill="var(--ink)" />
          </>
        )}
      </For>
    </>
  )
}

function CoverageItem(props: { letter: Letter; time: number }) {
  const order = buildOrder(props.letter)
  const shown = () =>
    Math.min(order.length, Math.floor(clamp(props.time / 1.0) * order.length + (props.time > 0 ? 1 : 0)))
  const cs = 22
  return (
    <>
      <rect x={0} y={0} width={4 * cs} height={7 * cs} fill="none" stroke="var(--line)" />
      <For each={order}>
        {(cell, i) => (
          <Show when={i() < shown()}>
            <rect x={cell[0] * cs + 1} y={cell[1] * cs + 1} width={cs - 2} height={cs - 2} fill="var(--ink)" />
          </Show>
        )}
      </For>
      <Mono x={110} y={60} size={36} fill="var(--ink)">
        {pad(shown())}/28
      </Mono>
      <Mono x={112} y={96} size={18}>
        {((shown() / 28) * 100).toFixed(1)}%
      </Mono>
    </>
  )
}

function ShadeItem(props: { letter: Letter; time: number }) {
  const cs = 22
  const shade = cells(props.letter, "+")
  return (
    <>
      <Index each={modules[props.letter]}>
        {(row, y) => (
          <Index each={[...row()]}>
            {(cell, x) => (
              <Show when={cell() !== "."}>
                <rect
                  x={x * cs + 1}
                  y={y * cs + 1}
                  width={cs - 2}
                  height={cs - 2}
                  fill={cell() === "#" ? "var(--ink)" : "var(--shade)"}
                />
              </Show>
            )}
          </Index>
        )}
      </Index>
      <Mono x={110} y={60} size={36} fill="var(--ink)">
        {shade.length} MOD
      </Mono>
      <Mono x={112} y={96} size={18}>
        {fmt(shade.length * 14400)} U²
      </Mono>
    </>
  )
}

/* ───────────────────────── 10 Loupe ───────────────────────── */

function LoupeScene(props: { c: Ctx }) {
  const c = props.c
  const m = Math.floor((c.H * (c.tall ? 0.6 : 0.84)) / 7)
  const gx = c.tall ? Math.round((c.W - 4 * m) / 2) : Math.round(c.W * 0.2)
  const gy = c.tall ? 40 : Math.round((c.H - 7 * m) / 2)
  const order = buildOrder("o")
  const half = c.at("half", 1)
  const counted = () => order.filter((_, i) => c.t() >= 0.2 + i * 0.14).length
  const zoom = 2.6
  const chipText = `×${zoom} · 144 SQUARES PER MODULE`
  // OpenTUI Mono advances 0.6 em; 16 px type plus 0.02 em tracking, and 8 px padding each side.
  const chip = chipText.length * 16 * 0.62 + 16
  const R = Math.round(m * 1.25)
  const lens = () => [
    gx + 2 * m + Math.cos(c.t() * 0.8 + 2.2) * 1.4 * m,
    gy + 3.5 * m + Math.sin(c.t() * 1.1 + 0.4) * 2 * m,
  ]
  const cx = c.tall ? 60 : Math.round(c.W * 0.6)
  const cy = c.tall ? gy + 7 * m + 120 : Math.round(c.H * 0.5)

  const body = (micro: boolean) => (
    <>
      <For each={cells("o", "+")}>
        {(cell) => <rect x={gx + cell[0] * m} y={gy + cell[1] * m} width={m} height={m} fill="var(--shade)" />}
      </For>
      <For each={order}>
        {(cell, i) => (
          <>
            <rect
              x={gx + cell[0] * m}
              y={gy + cell[1] * m}
              width={m}
              height={m}
              fill={c.t() >= 0.2 + i() * 0.14 && c.t() < 0.38 + i() * 0.14 ? "var(--accent)" : "var(--ink)"}
            />
            <Show when={!micro && c.t() >= 0.2 + i() * 0.14}>
              <Mono
                x={gx + cell[0] * m + m / 2}
                y={gy + cell[1] * m + m / 2 + 10}
                size={28}
                anchor="middle"
                fill="var(--bg)"
              >
                {pad(i() + 1)}
              </Mono>
            </Show>
          </>
        )}
      </For>
    </>
  )

  return (
    <Stage tone="dark" c={c}>
      {body(false)}
      <defs>
        <clipPath id="film-lens">
          <circle cx={lens()[0]} cy={lens()[1]} r={R} />
        </clipPath>
        <pattern id="film-micro" width={m / 12} height={m / 12} patternUnits="userSpaceOnUse" x={gx} y={gy}>
          <rect width={m / 12} height={m / 12} fill="none" stroke="#0c0c0c" stroke-width={1.5 / zoom} />
        </pattern>
      </defs>
      <g clip-path="url(#film-lens)">
        <rect x={lens()[0] - R} y={lens()[1] - R} width={R * 2} height={R * 2} fill="var(--bg)" />
        <g transform={`translate(${lens()[0]} ${lens()[1]}) scale(${zoom}) translate(${-lens()[0]} ${-lens()[1]})`}>
          {body(true)}
          <rect x={gx} y={gy} width={4 * m} height={7 * m} fill="url(#film-micro)" />
        </g>
      </g>
      <circle
        cx={lens()[0]}
        cy={lens()[1]}
        r={R}
        fill="none"
        stroke="var(--ink)"
        stroke-width="3"
        shape-rendering="geometricPrecision"
      />
      <line
        x1={lens()[0] - 14}
        x2={lens()[0] + 14}
        y1={lens()[1]}
        y2={lens()[1]}
        stroke="var(--accent)"
        stroke-width="2"
      />
      <line
        y1={lens()[1] - 14}
        y2={lens()[1] + 14}
        x1={lens()[0]}
        x2={lens()[0]}
        stroke="var(--accent)"
        stroke-width="2"
      />
      <Mono x={cx} y={cy - 150} size={22} fill="var(--ink)">
        INK MODULES, LETTER o
      </Mono>
      <Mono x={cx} y={cy} size={c.tall ? 120 : 180} fill="var(--ink)">
        {pad(counted())}/28
      </Mono>
      <Show when={c.t() >= half}>
        <Mono x={cx + 6} y={cy + 80} size={44} fill="var(--accent)">
          = 50.0% EXACTLY
        </Mono>
      </Show>
      {/* The loupe's label rides on its own chip, above everything it passes over. */}
      <rect
        x={Math.round(lens()[0] + R + 8)}
        y={Math.round(lens()[1] + R - 30)}
        width={Math.round(chip)}
        height={28}
        fill="#0c0c0c"
      />
      <Mono x={Math.round(lens()[0] + R + 16)} y={Math.round(lens()[1] + R - 10)} size={16} fill="var(--ink)">
        {chipText}
      </Mono>
    </Stage>
  )
}

/* ───────────────────────── 11 Kerning ───────────────────────── */

function KerningScene(props: { c: Ctx }) {
  const c = props.c
  const cw = c.tall ? 128 : 112
  const ch = c.tall ? 120 : 98
  const tw = cw * 7
  const th = ch * 7
  const ox = c.tall ? Math.round((c.W - tw) / 2) : Math.round(c.W * 0.12)
  const oy = c.tall ? 60 : Math.round((c.H - th) / 2)
  const every = c.at("kerning", 1)
  const zero = c.at("kerning", 2)
  const pairs = letters.flatMap((a, row) =>
    letters.map((b, col) => ({ a, b, row, col, at: 0.1 + (row * 6 + col) * 0.042 })),
  )
  const shown = () => pairs.filter((pair) => c.t() >= pair.at).length
  const rx = c.tall ? INSET : ox + tw + 90
  const ry = c.tall ? oy + th + 80 : oy + 60

  return (
    <Stage tone="light" c={c}>
      <g>
        <For each={letters}>
          {(letter, i) => (
            <>
              <Glyph letter={letter} x={ox + (i() + 1) * cw + cw / 2 - 12} y={oy + 20} m={6} />
              <Glyph letter={letter} x={ox + cw / 2 - 12} y={oy + (i() + 1) * ch + 20} m={6} />
            </>
          )}
        </For>
        <g stroke="var(--line)" stroke-width="1">
          <For each={Array.from({ length: 8 }, (_, i) => i)}>
            {(i) => (
              <>
                <line x1={ox + i * cw} x2={ox + i * cw} y1={oy} y2={oy + th} />
                <line y1={oy + i * ch} y2={oy + i * ch} x1={ox} x2={ox + tw} />
              </>
            )}
          </For>
        </g>
        <For each={pairs}>
          {(pair) => (
            <Show when={c.t() >= pair.at}>
              <g transform={`translate(${ox + (pair.col + 1) * cw} ${oy + (pair.row + 1) * ch})`}>
                <Glyph letter={pair.a} x={10} y={8} m={3} />
                <Glyph letter={pair.b} x={25} y={8} m={3} />
                <Mono
                  x={cw - 14}
                  y={ch - 16}
                  size={36}
                  anchor="end"
                  fill={c.t() >= every ? "var(--accent)" : "var(--ink)"}
                >
                  0
                </Mono>
              </g>
            </Show>
          )}
        </For>
      </g>
      <>
        <Mono x={rx} y={ry} size={22} fill="var(--ink)">
          KERNING TABLE
        </Mono>
        <Mono x={rx} y={ry + 60} size={44} fill="var(--ink)">
          PAIRS {pad(shown())}
        </Mono>
        <Mono x={rx} y={ry + 110} size={22}>
          NON-ZERO VALUES 0
        </Mono>
        <Mono x={rx} y={ry + 146} size={22}>
          SPACING 120 U, ALWAYS
        </Mono>
      </>
      <Show when={c.t() >= zero}>
        <Mono x={rx} y={ry + 198} size={22} fill="var(--accent)">
          KERN = 0 FOR ALL 36 PAIRS
        </Mono>
      </Show>
    </Stage>
  )
}

/* ───────────────────────── 12 Exploded view ───────────────────────── */

function ExplodedScene(props: { c: Ctx }) {
  const c = props.c
  const S = c.tall ? 28 : 36
  const unit = 0.9
  const word = [..."opencd"] as Letter[]
  const blocks = word
    .flatMap((letter, li) => [
      ...cells(letter, "+").map((cell) => ({ li, x: li * 5 + cell[0], y: cell[1], h: 0.34, tone: "shade" as const })),
      ...cells(letter, "#").map((cell) => ({ li, x: li * 5 + cell[0], y: cell[1], h: 1, tone: "ink" as const })),
    ])
    // Each module settles a little after the letter to its left and the row below it.
    .map((block) => ({ ...block, lift: (6 - block.y) * unit, delay: block.li * 0.035 + (6 - block.y) * 0.025 }))
  const B = c.at("cared", 1)
  const C = c.at("cared", 2)
  // Every module's height this frame, painted back to front by iso depth (x + y + z), so a lifted
  // module that passes in front of a lower one is drawn over it.
  const placed = createMemo(() =>
    blocks
      .map((block) => ({ ...block, z: block.lift * explodeFactor(c.t(), block.delay, B, C) }))
      .sort((a, b) => a.x + a.y + a.z + a.h / 2 - (b.x + b.y + b.z + b.h / 2)),
  )
  const mean = createMemo(
    () => blocks.reduce((sum, block) => sum + explodeFactor(c.t(), block.delay, B, C), 0) / blocks.length,
  )
  const ox = c.W / 2 - ((29 - 7) / 2) * 0.866 * S
  const base = c.H / 2 - ((29 + 7) / 2) * 0.5 * S
  const iso = (x: number, y: number, z: number) =>
    [ox + (x - y) * 0.866 * S, base + 3 * unit * S * mean() + (x + y) * 0.5 * S - z * S] as const
  const poly = (points: (readonly [number, number])[]) =>
    points.map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ")
  const faces = {
    ink: ["#f2f2f2", "#9a9a9a", "#c4c4c4"],
    shade: ["#5a5a5a", "#2e2e2e", "#3e3e3e"],
  }

  return (
    <Stage tone="dark" c={c}>
      <g stroke="#0c0c0c" stroke-width="1" stroke-linejoin="round" shape-rendering="geometricPrecision">
        <Index each={placed()}>
          {(block) => {
            const b = () => block()
            const top = () =>
              poly([
                iso(b().x, b().y, b().z + b().h),
                iso(b().x + 1, b().y, b().z + b().h),
                iso(b().x + 1, b().y + 1, b().z + b().h),
                iso(b().x, b().y + 1, b().z + b().h),
              ])
            const left = () =>
              poly([
                iso(b().x, b().y + 1, b().z + b().h),
                iso(b().x + 1, b().y + 1, b().z + b().h),
                iso(b().x + 1, b().y + 1, b().z),
                iso(b().x, b().y + 1, b().z),
              ])
            const right = () =>
              poly([
                iso(b().x + 1, b().y, b().z + b().h),
                iso(b().x + 1, b().y + 1, b().z + b().h),
                iso(b().x + 1, b().y + 1, b().z),
                iso(b().x + 1, b().y, b().z),
              ])
            return (
              <>
                <polygon points={left()} fill={faces[b().tone][1]} />
                <polygon points={right()} fill={faces[b().tone][2]} />
                <polygon points={top()} fill={faces[b().tone][0]} />
              </>
            )
          }}
        </Index>
      </g>
      <Mono x={INSET} y={c.H - 110} size={20} fill="var(--ink)">
        EXPLODED VIEW · z = e × {Math.round(unit * 120)}u × (6 − row)
      </Mono>
      <Mono x={INSET} y={c.H - 50} size={44} fill={mean() < 0.005 ? "var(--accent)" : "var(--ink)"}>
        e = {mean().toFixed(2)}
      </Mono>
    </Stage>
  )
}

/* ───────────────────────── 13 49,208 bytes ───────────────────────── */

function BytesScene(props: { c: Ctx }) {
  const c = props.c
  const value = () => performance.otf * ease.outExpo(span(c.t(), 0.1, 1.3))
  const after = c.at("bytes", 1)
  const kb = Math.ceil(performance.otf / 1024)
  const bw = c.W - (c.tall ? 120 : 320)
  const bx = (c.W - bw) / 2
  const by = c.H * 0.62
  const cell = bw / kb

  return (
    <Stage tone="blue" c={c} push={[1, 1.05]}>
      <Mono x={c.W / 2} y={c.H * 0.22} size={22} anchor="middle" fill="var(--ink)">
        OPENCODE.OTF · OPENTYPE
      </Mono>
      <Mono x={c.W / 2} y={c.H * 0.5} size={c.tall ? 190 : 300} anchor="middle" fill="var(--ink)">
        {fmt(value())}
      </Mono>
      <For each={Array.from({ length: kb }, (_, i) => i)}>
        {(i) => (
          <rect
            x={Math.round(bx + i * cell)}
            y={by}
            width={Math.max(1, Math.round(cell) - 3)}
            height={28}
            fill={
              value() >= (i + 1) * 1024 || (i === kb - 1 && value() >= performance.otf - 1)
                ? "var(--ink)"
                : "var(--line)"
            }
          />
        )}
      </For>
      <Mono x={bx} y={by + 64} size={20} fill="var(--ink)">
        BYTES
      </Mono>
      <Mono x={bx + bw} y={by + 64} size={20} anchor="end" fill="var(--ink)">
        {kb} × 1 KB
      </Mono>
      <Show when={c.t() >= after}>
        <Mono x={c.W / 2} y={by + 140} size={c.tall ? 22 : 28} anchor="middle" fill="var(--ink)">
          GZIP {fmt(performance.gzip)} · BROTLI {fmt(performance.brotli)} · DECORATION 0
        </Mono>
      </Show>
    </Stage>
  )
}

/* ───────────────────────── 14 The only six ───────────────────────── */

const POOL = "ABCDEFGHIJKLMNQRSTUVWXYZabfghijklmqrstuvwxyz0123456789&@#%?!ÀÉÎÕÜßæøåçñ§¶*+=/<>"

function ThousandsScene(props: { c: Ctx }) {
  const c = props.c
  const px = 20
  const py = 30
  const cols = Math.floor(c.W / px)
  const rows = Math.floor(c.H / py)
  const total = cols * rows
  const buckets = 24
  const B = c.at("thousands", 1)
  const sixes = letters.map((letter, i) => {
    const col = Math.floor(cols * (0.18 + 0.13 * i + hash(i) * 0.05))
    const row = Math.floor(rows * (0.2 + hash(i + 9) * 0.6))
    return { letter, col, row }
  })
  const special = new Set(sixes.map((six) => six.row * cols + six.col))
  const lines = Array.from({ length: buckets }, (_, b) =>
    Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const index = row * cols + col
        if (special.has(index)) return " "
        if (Math.floor(hash(index + 101) * buckets) !== b) return " "
        return POOL[Math.floor(hash(index) * POOL.length)]
      }).join(""),
    ),
  )

  return (
    <Stage tone="dark" c={c}>
      <For each={lines}>
        {(bucket, b) => (
          <Show when={c.t() < B + b() * 0.02}>
            <g fill="#6a6a6a">
              <For each={bucket}>
                {(line, row) => (
                  <Show when={c.t() >= row() * 0.03}>
                    <text
                      data-type="mono"
                      x={0}
                      y={row() * py + 22}
                      font-size="20"
                      style={{ "white-space": "pre" }}
                      textLength={cols * px}
                      lengthAdjust="spacing"
                    >
                      {line}
                    </text>
                  </Show>
                )}
              </For>
            </g>
          </Show>
        )}
      </For>
      {/* The six stay exactly where they were and turn blue once the rest are gone. */}
      <For each={sixes}>
        {(six) => (
          <g style={c.t() >= B ? { "--glyph-ink": "var(--accent)" } : undefined}>
            <Glyph letter={six.letter} x={six.col * px + 4} y={six.row * py + 4} m={3} />
          </g>
        )}
      </For>
      <rect x={c.W - 300} y={c.H - 76} width={280} height={56} fill="var(--bg)" />
      <Show when={c.t() < B}>
        <Mono x={c.W - 40} y={c.H - 40} size={22} anchor="end" fill="var(--ink)">
          GLYPHS {fmt(Math.min(total, Math.floor((c.t() / 1.1) * total)))}
        </Mono>
      </Show>
      <Show when={c.t() >= B}>
        <Mono x={c.W - 40} y={c.H - 40} size={22} anchor="end" fill="var(--accent)">
          GLYPHS 6
        </Mono>
      </Show>
    </Stage>
  )
}

/* ───────────────────────── Born in the terminal ───────────────────────── */

// The TUI wordmark, from packages/tui/src/logo.ts. Each character is one terminal cell: █ full, ▀ top
// half, ▄ bottom half, "_" a cell of shadow background, "^" a top half over shadow, "~" and ","
// shadow halves. A cell is twice as tall as it is wide, so each half-cell is one square module.
const TUI_LOGO = {
  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

function TerminalScene(props: { c: Ctx }) {
  const c = props.c
  // The whole frame is a terminal: a grid of cells m wide and 2m tall, aligned so the 39-cell
  // wordmark sits in the middle. Each half-block is one square module.
  const m = Math.floor(Math.min((c.W * 0.8) / 39, (c.H * 0.6) / 8))
  const ox = Math.round((c.W - 39 * m) / 2)
  // The wordmark's four lines (8m tall), a cell row below the middle so the notes above have room.
  const oy = Math.round((c.H - 8 * m) / 2 + 2 * m)
  const columns = Array.from({ length: Math.ceil(c.W / m) + 2 }, (_, k) => ox + (k - Math.ceil(ox / m)) * m)
  const lines = Array.from(
    { length: Math.ceil(c.H / (2 * m)) + 2 },
    (_, k) => oy + (k - Math.ceil(oy / (2 * m))) * 2 * m,
  )
  const output = (line: number) => c.t() >= 0.15 + line * 0.12
  const cell = c.at("terminal", 1)
  const width = c.at("terminal", 2)
  const render = c.at("terminal", 3)
  const swap = c.at("terminal", 4)
  const palette = {
    left: { fg: "#808080", shadow: "#292929" },
    right: { fg: "#f2f2f2", shadow: "#464646" },
  }
  const blocks = TUI_LOGO.left.flatMap((_, line) =>
    (["left", "right"] as const).flatMap((side) =>
      [...TUI_LOGO[side][line]].flatMap((char, j) => {
        const x = ox + (side === "left" ? j : 20 + j) * m
        const y = oy + line * 2 * m
        const color = palette[side]
        const half = (top: boolean, fill: string) => ({ x, y: top ? y : y + m, h: m, fill, line })
        if (char === "█") return [{ x, y, h: 2 * m, fill: color.fg, line }]
        if (char === "▀") return [half(true, color.fg)]
        if (char === "▄") return [half(false, color.fg)]
        if (char === "_") return [{ x, y, h: 2 * m, fill: color.shadow, line }]
        if (char === "^") return [half(true, color.fg), half(false, color.shadow)]
        if (char === "~") return [half(true, color.shadow)]
        if (char === ",") return [half(false, color.shadow)]
        return []
      }),
    ),
  )
  const word = layout("opencode")
  // Notes stack upward from above line 0 (which holds the d's ascender), so none touches a glyph. The
  // o's bracket sits in line 0's empty cells just above the o.
  const above = oy + 2 * m - 18
  const note = (row: number) => oy - 16 - row * 30

  return (
    <Stage tone="dark" c={c}>
      <g stroke="rgb(242 242 242 / 1)" stroke-width="1" opacity={c.t() >= render ? 0.13 : 0.07}>
        <For each={columns}>{(x) => <line x1={x + 0.5} x2={x + 0.5} y1={0} y2={c.H} />}</For>
        <For each={lines}>{(y) => <line y1={y + 0.5} y2={y + 0.5} x1={0} x2={c.W} />}</For>
      </g>
      <Show when={c.t() < swap}>
        <For each={blocks}>
          {(block) => (
            <Show when={output(block.line)}>
              <rect x={block.x} y={block.y} width={m} height={block.h} fill={block.fill} />
            </Show>
          )}
        </For>
      </Show>
      <Show when={c.t() >= swap}>
        <For each={word.items}>
          {(item) => item.letter && <Glyph letter={item.letter} x={ox + (item.x / 6) * m} y={oy + m} m={m} />}
        </For>
      </Show>
      {/* One cell of the c's top row (a ▀), outlined on its own borders; the dashed line splits its two modules. */}
      <Show when={c.t() >= cell && c.t() < swap}>
        <rect
          x={ox + 21 * m + 0.5}
          y={oy + 2 * m + 0.5}
          width={m - 1}
          height={2 * m - 1}
          fill="none"
          stroke="var(--accent)"
        />
        <line
          x1={ox + 21 * m}
          x2={ox + 22 * m}
          y1={oy + 3 * m + 0.5}
          y2={oy + 3 * m + 0.5}
          stroke="var(--accent)"
          stroke-dasharray="2 2"
        />
        <line
          x1={ox + 21.5 * m + 0.5}
          x2={ox + 21.5 * m + 0.5}
          y1={note(0) + 8}
          y2={oy + 2 * m}
          stroke="var(--accent)"
        />
        <Mono x={ox + 21.5 * m - 6} y={note(0)} size={18} fill="var(--accent)">
          1 CELL = 2 MODULES · ONE HALF-BLOCK = 1 MODULE
        </Mono>
      </Show>
      <Show when={c.t() >= width}>
        <path d={`M${ox + 0.5} ${above + 8}v-8H${ox + 4 * m - 0.5}v8`} fill="none" stroke="var(--accent)" />
        <Mono x={ox} y={note(0)} size={18} fill="var(--accent)">
          4 CELLS WIDE · 7 HALF-CELLS TALL
        </Mono>
      </Show>
      <Show when={c.t() >= swap}>
        <Mono x={ox} y={note(1)} size={18} fill="var(--accent)">
          OPENCODE.OTF · THE SAME GRID, CELL FOR CELL
        </Mono>
      </Show>
    </Stage>
  )
}

/* ───────────────────────── 6^3,591 ───────────────────────── */

const SAMPLE = ["the quick brown fox", "jumps over the lazy dog"]
// 6^3591: 3,591 characters, each drawn with one of six letters.
let digitsCache: string | undefined
const digits = () => (digitsCache ??= (6n ** 3591n).toString())

/** The letter a character is drawn with in variant `v`: the six keep their identity. */
function mapped(char: string, v: number): Letter | undefined {
  if (char === " ") return undefined
  if (isLetter(char)) return char
  return letters[Math.floor(hash(char.charCodeAt(0) * 131 + v * 7919) * letters.length)]
}

/** The font file's signature for variant `v`, as font.mjs names it: FNV-1a over the map. */
function signature(v: number) {
  let value = 2166136261
  for (const char of SAMPLE.join("")) {
    const letter = mapped(char, v)
    if (letter) value = Math.imul(value ^ letter.charCodeAt(0), 16777619) >>> 0
  }
  return value.toString(16).padStart(8, "0")
}

function SampleLines(props: { v: number; c: Ctx; m: number; top: number; label?: boolean }) {
  return (
    <For each={SAMPLE}>
      {(line, row) => {
        const shape = layout(line)
        const x = Math.round((props.c.W - (shape.width / 6) * props.m) / 2)
        const y = props.top + row() * (7 * props.m + 56)
        return (
          <>
            <Show when={props.label}>
              <Mono x={x} y={y - 12} size={16}>
                {line}
              </Mono>
            </Show>
            <For each={shape.items}>
              {(item) => {
                const letter = () => mapped(item.char, props.v)
                return (
                  <Show when={letter()}>
                    {(l) => <Glyph letter={l()} x={x + (item.x / 6) * props.m} y={y} m={props.m} />}
                  </Show>
                )
              }}
            </For>
          </>
        )
      }}
    </For>
  )
}

function VariantsScene(props: { c: Ctx }) {
  const c = props.c
  const flurry = c.at("combinations", 1)
  const wall = c.at("combinations", 2)
  const long = c.at("combinations", 3)
  const six = placeRows(["o p e n c d"], c, 0.7)
  // New maps come faster and faster: every 0.4 s at first, every frame by the end.
  const variant = () => {
    const t = Math.max(0, c.t() - flurry)
    const span = wall - flurry
    return 1 + Math.floor(t * (2.5 + (fps - 2.5) * Math.min(1, t / span) ** 2))
  }
  const m = Math.floor(Math.min((c.W * 0.9) / (layout(SAMPLE[1]).width / 6), c.H / 30))
  const all = digits()
  const perLine = Math.floor((c.W - INSET * 2) / (16 * 0.62))
  const shown = () => Math.floor(clamp((c.t() - wall) / Math.max(0.5, long - wall - 0.2)) * all.length)
  const lineCount = Math.ceil(all.length / perLine)
  const top = Math.round((c.H - lineCount * 24) / 2)

  return (
    <Stage tone="dark" c={c}>
      <Show when={c.t() < flurry}>
        <For each={six.items}>
          {(item, i) =>
            item.letter && (
              <Show when={c.t() >= i() * 0.05}>
                <Glyph letter={item.letter} x={item.px} y={item.py} m={six.m} />
              </Show>
            )
          }
        </For>
      </Show>
      <Show when={c.t() >= flurry && c.t() < wall}>
        <SampleLines v={variant()} c={c} m={m} top={Math.round(c.H / 2 - 7 * m - 28)} label />
        <Mono x={INSET} y={INSET + 10} size={20} fill="var(--ink)">
          MAP {fmt(variant()).padStart(5, "0")}
        </Mono>
        <Mono x={c.W - INSET} y={INSET + 10} size={20} anchor="end">
          OPENCODE-{signature(variant()).toUpperCase()}-REGULAR
        </Mono>
      </Show>
      <Show when={c.t() >= wall}>
        <g fill="var(--muted)">
          <For each={Array.from({ length: lineCount }, (_, i) => i)}>
            {(i) => (
              <Show when={shown() > i * perLine}>
                <text data-type="mono" x={INSET} y={top + i * 24} font-size="16">
                  {all.slice(i * perLine, Math.min(shown(), (i + 1) * perLine))}
                </text>
              </Show>
            )}
          </For>
        </g>
        <rect x={INSET - 12} y={c.H - INSET - 44} width={420} height={60} fill="var(--bg)" />
        <Mono x={INSET} y={c.H - INSET} size={36} fill="var(--ink)">
          6^3,591 · {fmt(Math.min(all.length, Math.ceil(shown())))} DIGITS
        </Mono>
      </Show>
    </Stage>
  )
}

/* ───────────────────────── Yours ───────────────────────── */

function YoursScene(props: { c: Ctx }) {
  const c = props.c
  const word = placeRows(["opencode"], c, c.tall ? 0.86 : 0.6)
  // Just the word; the film fades to black under "yours alone" (see Film).
  return (
    <Stage tone="dark" c={c}>
      <For each={word.items}>
        {(item) => item.letter && <Glyph letter={item.letter} x={item.px} y={item.py} m={word.m} />}
      </For>
    </Stage>
  )
}

/* ───────────────────────── Poster ───────────────────────── */

/**
 * The plate's start screen: "opencode" on its module grid, without the grid's tolerance line.
 * Inverted is white on black, the shade as white at the shade's opacity; light is the grid frame.
 */
function PosterScene(props: { tone: "inverted" | "light"; c: Ctx }) {
  const c = props.c
  const word = placeRows(wordRows("opencode", c, 4), c, 0.86)
  const m = word.m
  const verticals = Array.from({ length: Math.ceil(c.W / m) + 1 }, (_, k) => word.ox + (k - Math.ceil(word.ox / m)) * m)
  const horizontals = Array.from(
    { length: Math.ceil(c.H / m) + 1 },
    (_, k) => word.oy + (k - Math.ceil(word.oy / m)) * m,
  )
  const inverted = props.tone === "inverted"
  return (
    <Stage tone={inverted ? "dark" : "light"} c={c}>
      <g
        style={
          inverted
            ? {
                "--glyph-ink": "#ffffff",
                "--glyph-shadow": "rgb(255 255 255 / 0.28)",
                "--line": "rgb(255 255 255 / 0.08)",
              }
            : undefined
        }
      >
        <g stroke="var(--line)" stroke-width="1" opacity={inverted ? 1 : 0.55}>
          <For each={verticals}>{(x) => <line x1={x} x2={x} y1={0} y2={c.H} />}</For>
          <For each={horizontals}>{(y) => <line y1={y} y2={y} x1={0} x2={c.W} />}</For>
        </g>
        <For each={word.items}>
          {(item) => item.letter && <Glyph letter={item.letter} x={item.px} y={item.py} m={m} />}
        </For>
      </g>
    </Stage>
  )
}
