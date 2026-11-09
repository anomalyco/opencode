import { createMemo, createSignal, For, Index, onMount, Show } from "solid-js"
import {
  buildOrder,
  cells,
  constructionPhases,
  fontContent,
  glyphNames,
  glyphs,
  letters,
  moduleCount,
  modules,
  anchors,
  type Letter,
} from "~/lib/font-content"
import { GlyphShape } from "./glyph"
import { ease, Plate, prefersReducedMotion, span, useClock, useSeen, useVisible } from "./plate"

const HOLD = 1800
const FADE = 400

/** The length of one construction loop, including the hold on the finished glyph. */
const loopLength = (letter: Letter) => constructionPhases(letter).at(-1)!.end + HOLD + FADE
const finished = (letter: Letter) => constructionPhases(letter).at(-1)!.end + 200

/** Width in modules of the white run in row 2 that starts at column 1: the glyph's counter. */
const counterWidth = (letter: Letter) => (modules[letter][2].slice(1).match(/^\.+/)?.[0].length ?? 0) * 120

const gridLines = [
  ...[0, 6, 12, 18, 24].map((x) => ({ x1: x, y1: -3, x2: x, y2: 45 })),
  ...[0, 6, 12, 18, 24, 30, 36, 42].map((y) => ({ x1: -3, y1: y, x2: 27, y2: y })),
]
const metricLines = [
  { y: 6, label: "x 600" },
  { y: 36, label: "base 0" },
  { y: 0, label: "asc 720" },
  { y: 42, label: "desc −120" },
]

/**
 * One glyph built from nothing, as a function of time: the grid draws on, the metrics follow, the
 * modules appear one by one along the strokes at full size, the shade fills in module by module,
 * the outline traces, then the measurements arrive. Pure SVG; `time` is in milliseconds.
 */
export function ConstructionFigure(props: { letter: Letter; time: number; label?: boolean }) {
  const phases = createMemo(() => Object.fromEntries(constructionPhases(props.letter).map((p) => [p.id, p])))
  const order = createMemo(() => buildOrder(props.letter))
  const shade = createMemo(() => cells(props.letter, "+").sort((a, b) => a[1] - b[1] || a[0] - b[0]))
  const points = createMemo(() => anchors(props.letter))
  const t = () => props.time % loopLength(props.letter)
  const fade = () => 1 - ease.inOut(span(t(), loopLength(props.letter) - FADE, FADE))
  const placed = () => order().filter((_, index) => t() >= phases().modules.start + index * 90).length
  const callout = (index: number) => ease.out(span(t(), phases().callouts.start + index * 260, 420))
  const current = () => constructionPhases(props.letter).findLast((phase) => t() >= phase.start)

  return (
    <svg
      data-component="construction-figure"
      viewBox="-11 -11 48 64"
      role="img"
      aria-label={`Construction of the letter ${props.letter}: grid, metrics, ${moduleCount(props.letter, "#")} modules, shade, outline and measurements`}
      style={{ opacity: fade() }}
    >
      <g data-slot="grid">
        <Index each={gridLines}>
          {(line, index) => (
            <line
              {...line()}
              pathLength="1"
              stroke-dasharray="1"
              stroke-dashoffset={1 - ease.outExpo(span(t(), index * 35, 420))}
            />
          )}
        </Index>
      </g>
      <g data-slot="metrics">
        <Index each={metricLines}>
          {(metric, index) => {
            const progress = () => ease.out(span(t(), phases().metrics.start + index * 90, 380))
            return (
              <>
                <line
                  x1="-9"
                  x2="35"
                  y1={metric().y}
                  y2={metric().y}
                  pathLength="1"
                  stroke-dasharray="1"
                  stroke-dashoffset={1 - progress()}
                />
                <text x="-9" y={metric().y - 0.9} opacity={progress()}>
                  {metric().label}
                </text>
              </>
            )
          }}
        </Index>
      </g>
      <g data-slot="shade">
        <Index each={shade()}>
          {(cell, index) => (
            // Each shade module appears whole on its step, top row first.
            <rect
              x={cell()[0] * 6}
              y={cell()[1] * 6}
              width="6"
              height="6"
              visibility={t() >= phases().shade.start + index * 50 ? "visible" : "hidden"}
            />
          )}
        </Index>
      </g>
      <g data-slot="modules">
        <Index each={order()}>
          {(cell, index) => {
            // Each module appears whole on its step: no tween. The newest one is blue until the next lands.
            const start = () => phases().modules.start + index * 90
            return (
              <rect
                x={cell()[0] * 6}
                y={cell()[1] * 6}
                width="6"
                height="6"
                visibility={t() >= start() ? "visible" : "hidden"}
                data-new={t() >= start() && t() < start() + 90 ? "" : undefined}
              />
            )
          }}
        </Index>
      </g>
      <path
        data-slot="trace"
        d={glyphs[props.letter].ink}
        pathLength="1"
        stroke-dasharray="1"
        stroke-dashoffset={1 - ease.inOut(span(t(), phases().outline.start, 800))}
      />
      <g data-slot="anchors">
        <Index each={points()}>
          {(point, index) => {
            // Anchors appear whole as the trace reaches them.
            const shown = () => t() >= phases().outline.start + (index / points().length) * 800
            return (
              <rect
                x={point()[0] - 0.8}
                y={point()[1] - 0.8}
                width="1.6"
                height="1.6"
                visibility={shown() ? "visible" : "hidden"}
                vector-effect="non-scaling-stroke"
              />
            )
          }}
        </Index>
      </g>
      <g data-slot="callouts">
        <g opacity={callout(0)}>
          <path d="M0 -6V-3M6 -6V-3M0 -4.5H6" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - callout(0)} />
          <text x="3" y="-7.2" text-anchor="middle">
            stem 120
          </text>
        </g>
        <Show when={counterWidth(props.letter)}>
          <g opacity={callout(1)}>
            <path
              d={`M6 15H${6 + counterWidth(props.letter) / 20}`}
              pathLength="1"
              stroke-dasharray="1"
              stroke-dashoffset={1 - callout(1)}
            />
            <text x={6 + counterWidth(props.letter) / 40} y="13.8" text-anchor="middle">
              {counterWidth(props.letter)}
            </text>
          </g>
        </Show>
        <g opacity={callout(2)}>
          <path
            d="M28 6H31M28 36H31M29.5 6V36"
            pathLength="1"
            stroke-dasharray="1"
            stroke-dashoffset={1 - callout(2)}
          />
          <text x="31.4" y="21.6">
            600
          </text>
        </g>
        <g opacity={callout(3)}>
          <path
            d="M-3 47H27M-3 45.5V48.5M27 45.5V48.5"
            pathLength="1"
            stroke-dasharray="1"
            stroke-dashoffset={1 - callout(3)}
          />
          <text x="12" y="51.4" text-anchor="middle">
            advance 600
          </text>
        </g>
      </g>
      <Show when={props.label !== false}>
        <text data-slot="readout" x="-9" y="-7.2">
          {props.letter} · {String(placed()).padStart(2, "0")}/{order().length}
        </text>
        <text data-slot="readout" x="35" y="51.4" text-anchor="end">
          {current()?.label.toLowerCase()} {String(Math.round(t())).padStart(4, "0")}ms
        </text>
      </Show>
    </svg>
  )
}

/** Plate: one large construction you can scrub, and all six running side by side. */
export function Construction() {
  let stage: HTMLDivElement | undefined
  const visible = useVisible(() => stage)
  const [letter, setLetter] = createSignal<Letter>("d")
  const [playing, setPlaying] = createSignal(true)
  const [motion, setMotion] = createSignal(true)
  onMount(() => setMotion(!prefersReducedMotion()))
  const [time, setTime] = useClock(() => visible() && playing() && motion())
  const shown = () => (motion() ? time() : finished(letter()))
  const phases = createMemo(() => constructionPhases(letter()))
  const loop = () => loopLength(letter())
  const local = () => shown() % loop()

  return (
    <Plate id="construction" tone="ink" lead={fontContent.construction.lead} aside="Live · SVG · scrub to inspect">
      <div data-slot="construction-stage" ref={stage}>
        <div data-slot="construction-main">
          <ConstructionFigure letter={letter()} time={shown()} />
        </div>
        <div data-slot="construction-side">
          <div data-slot="letter-tabs" role="group" aria-label="Letter">
            <For each={letters}>
              {(item) => (
                <button
                  type="button"
                  aria-pressed={letter() === item}
                  aria-label={glyphNames[item]}
                  onClick={() => {
                    setLetter(item)
                    setTime(0)
                  }}
                >
                  <svg viewBox="0 0 24 42" aria-hidden="true">
                    <GlyphShape letter={item} />
                  </svg>
                </button>
              )}
            </For>
          </div>
          <ol data-slot="phases">
            <For each={phases()}>
              {(phase, index) => (
                <li
                  data-active={local() >= phase.start && local() < phase.end ? "" : undefined}
                  data-done={local() >= phase.end ? "" : undefined}
                >
                  <span data-anno>{String(index() + 1).padStart(2, "0")}</span>
                  <span>{phase.label}</span>
                  <span data-anno>
                    {phase.start}–{phase.end}ms
                  </span>
                  <span data-slot="phase-bar" style={{ "--progress": span(local(), phase.start, phase.duration) }} />
                </li>
              )}
            </For>
          </ol>
          <div data-slot="transport">
            <button type="button" onClick={() => setPlaying(!playing())} disabled={!motion()}>
              {playing() && motion() ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={() => setTime(0)} disabled={!motion()}>
              Replay
            </button>
            <label>
              <span data-slot="sr-only">Scrub the construction</span>
              <input
                type="range"
                min="0"
                max={loop() - FADE}
                step="10"
                value={local()}
                onInput={(event) => {
                  setPlaying(false)
                  setMotion(true)
                  setTime(Number(event.currentTarget.value))
                }}
              />
            </label>
            <output data-anno>{String(Math.round(local())).padStart(4, "0")}ms</output>
          </div>
        </div>
      </div>
      <SmallConstructions />
    </Plate>
  )
}

function SmallConstructions() {
  let row: HTMLDivElement | undefined
  const visible = useVisible(() => row)
  const [motion, setMotion] = createSignal(true)
  onMount(() => setMotion(!prefersReducedMotion()))
  const [time] = useClock(() => visible() && motion())
  return (
    <div data-slot="construction-row" ref={row}>
      <For each={letters}>
        {(letter, index) => (
          <figure>
            <ConstructionFigure
              letter={letter}
              time={motion() ? time() + index() * 650 : finished(letter)}
              label={false}
            />
            <figcaption data-anno>
              {letter} · {moduleCount(letter, "#")} + {moduleCount(letter, "+")} modules
            </figcaption>
          </figure>
        )}
      </For>
    </div>
  )
}

/** Plate: the construction phases of all six letters as a Gantt chart, with a running playhead. */
export function Timeline() {
  let chart: HTMLDivElement | undefined
  const seen = useSeen(() => chart)
  const longest = Math.max(...letters.map((letter) => constructionPhases(letter).at(-1)!.end))
  const ticks = Array.from({ length: Math.floor(longest / 500) + 1 }, (_, index) => index * 500)
  return (
    <Plate id="timeline" lead={fontContent.timeline.lead} aside={`Total ${longest}ms · 6 tracks`}>
      <div
        data-slot="gantt"
        ref={chart}
        data-seen={seen() ? "" : undefined}
        style={{ "--total": `${longest}ms` }}
        role="table"
        aria-label="Construction timeline"
      >
        <div data-slot="gantt-ticks" aria-hidden="true">
          <For each={ticks}>
            {(tick) => (
              <span data-anno style={{ left: `${(tick / longest) * 100}%` }}>
                {tick}
              </span>
            )}
          </For>
        </div>
        <For each={letters}>
          {(letter) => (
            <div data-slot="gantt-row" role="row">
              <span data-slot="gantt-label" role="rowheader">
                <svg viewBox="0 0 24 42" aria-hidden="true">
                  <GlyphShape letter={letter} />
                </svg>
                <span data-anno>{letter}</span>
              </span>
              <div data-slot="gantt-track" role="cell">
                <For each={constructionPhases(letter)}>
                  {(phase) => (
                    <span
                      data-slot="gantt-bar"
                      data-phase={phase.id}
                      style={{
                        left: `${(phase.start / longest) * 100}%`,
                        width: `${(phase.duration / longest) * 100}%`,
                        "--delay": `${phase.start * 0.35}ms`,
                      }}
                      title={`${phase.label}: ${phase.start}–${phase.end}ms`}
                    >
                      <span data-anno>{phase.label}</span>
                    </span>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
        <span data-slot="gantt-playhead" aria-hidden="true" />
      </div>
      {/* Phones: the bars are too short for their names, so a legend under the chart names the
          colours instead (index.css shows it under 34rem). The bars keep their names for screen
          readers, so the legend is hidden from them. */}
      <ul data-slot="gantt-legend" aria-hidden="true">
        <For each={constructionPhases(letters[0])}>
          {(phase) => (
            <li>
              <span data-slot="gantt-swatch" data-phase={phase.id} />
              <span data-anno>{phase.label}</span>
            </li>
          )}
        </For>
      </ul>
    </Plate>
  )
}
