import { createSignal, For, Index, onMount, Show } from "solid-js"
import {
  bigrams,
  contours,
  counterModules,
  coverage,
  fontContent,
  glyphNames,
  glyphs,
  heatmap,
  letterFrequency,
  letters,
  moduleCount,
  performance,
  symmetry,
  versions,
  words,
  type Letter,
} from "~/lib/font-content"
import { GlyphShape, Word } from "./glyph"
import { useVisible } from "~/component/site/visible"
import { Plate, useSeen } from "./plate"

const topBigram = Object.entries(bigrams).sort((a, b) => b[1] - a[1])[0]
const zeroBigrams = Object.values(bigrams).filter((count) => count === 0).length
const sharedPositions = heatmap.flat().filter((count) => count === 6).length
// Ink inside the x-height plus the white modules there always make the 20 modules of the box.
const counterGroups = [...new Set(letters.map(counterModules))].map((counter) => ({
  counter,
  letters: letters.filter((letter) => counterModules(letter) === counter),
}))

const percent = (value: number) => `${Math.round(value * 100)}%`
const number = (value: number) => value.toLocaleString("en")

/** A small glyph, with the letter as text for screen readers (it heads table rows). */
function Mini(props: { letter: Letter }) {
  return (
    <>
      <svg data-slot="mini" viewBox="0 0 24 42" aria-hidden="true">
        <GlyphShape letter={props.letter} />
      </svg>
      <span data-slot="sr-only">{props.letter}</span>
    </>
  )
}

/** A chart card: a mono figure number and title, the chart, and a one-line reading of it. */
function Figure(props: { index: number; title: string; note: string; wide?: boolean; children: any }) {
  return (
    <figure data-slot="chart" data-wide={props.wide ? "" : undefined}>
      <header data-anno>
        <span>Fig. {String(props.index).padStart(2, "0")}</span>
        <span>{props.title}</span>
      </header>
      {props.children}
      <figcaption>{props.note}</figcaption>
    </figure>
  )
}

/** Plate: the font counted. Bars grow in when the plate scrolls into view. */
export function Analysis() {
  let root: HTMLDivElement | undefined
  const seen = useSeen(() => root)
  const maxModules = Math.max(...letters.map((letter) => moduleCount(letter, "#") + moduleCount(letter, "+")))
  const maxFrequency = Math.max(...Object.values(letterFrequency))
  const maxBigram = Math.max(...Object.values(bigrams))
  return (
    <Plate id="analysis" tone="paper" lead={fontContent.analysis.lead} aside="8 figures · computed from the outlines">
      <div data-slot="charts" ref={root} data-seen={seen() ? "" : undefined}>
        <Figure
          index={1}
          title="Modules per glyph"
          note="Ink in blue, shade in grey. The n and the c are the lightest letters."
        >
          <div data-slot="bars" role="table" aria-label="Modules per glyph">
            <For each={letters}>
              {(letter, index) => (
                <div data-slot="bar-row" role="row" style={{ "--i": index() }}>
                  <span role="rowheader">
                    <Mini letter={letter} />
                  </span>
                  <span
                    data-slot="bar-track"
                    role="cell"
                    aria-label={`${moduleCount(letter, "#")} ink, ${moduleCount(letter, "+")} shade`}
                  >
                    <span
                      data-slot="bar"
                      data-tone="ink"
                      style={{ width: `${(moduleCount(letter, "#") / maxModules) * 100}%` }}
                    />
                    <span
                      data-slot="bar"
                      data-tone="shade"
                      style={{ width: `${(moduleCount(letter, "+") / maxModules) * 100}%` }}
                    />
                  </span>
                  <span data-anno>
                    {moduleCount(letter, "#")}+{moduleCount(letter, "+")}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Figure>

        <Figure
          index={2}
          title="Ink coverage"
          note="Share of the 4 × 7 cell that is ink. Never more than 54%, never less than 39%."
          wide
        >
          <div data-slot="numerals">
            <For each={letters}>
              {(letter) => (
                <div>
                  <span data-slot="numeral">{percent(coverage(letter))}</span>
                  <span data-anno>{letter}</span>
                </div>
              )}
            </For>
          </div>
        </Figure>

        <Figure
          index={3}
          title="Ink against counter"
          note="Ink against white modules inside the x-height. Every letter lands on one line: they always add up to 20."
        >
          <svg
            data-slot="scatter"
            viewBox="0 0 120 90"
            role="img"
            aria-label="Ink modules against counter modules for each glyph"
          >
            <Index each={Array.from({ length: 5 })}>
              {(_, index) => <line data-slot="axis-line" x1="10" x2="116" y1={10 + index * 18} y2={10 + index * 18} />}
            </Index>
            <line data-slot="axis" x1="10" x2="116" y1="82" y2="82" />
            <line data-slot="axis" x1="10" x2="10" y1="6" y2="82" />
            <line data-slot="trend" x1="32.5" y1="5" x2="107.5" y2="75" />
            <For each={counterGroups}>
              {(group) => {
                const x = 10 + (20 - group.counter - 9) * 15
                const y = 82 - (group.counter - 4) * 14
                return (
                  <g>
                    <rect x={x - 1.6} y={y - 1.6} width="3.2" height="3.2" />
                    <text x={x + 2.6} y={y - 2.4}>
                      {group.letters.join(" ")}
                    </text>
                  </g>
                )
              }}
            </For>
            <text x="116" y="88" text-anchor="end">
              ink →
            </text>
            <text x="12" y="5">
              ↑ counter
            </text>
          </svg>
        </Figure>

        <Figure index={4} title="Stroke contrast" note="Thick over thin, measured on every stroke. There is no thin.">
          <div data-slot="contrast">
            <span data-slot="numeral" data-size="xl">
              1:1
            </span>
            <span data-anno>120u / 120u · σ = 0</span>
          </div>
        </Figure>

        <Figure
          index={5}
          title="Symmetry"
          note="How much of the ink survives a mirror, left to right and top to bottom."
        >
          <div data-slot="symmetry" role="table" aria-label="Symmetry per glyph">
            <For each={letters}>
              {(letter, index) => (
                <div role="row" style={{ "--i": index() }}>
                  <span role="rowheader">
                    <Mini letter={letter} />
                  </span>
                  <span
                    role="cell"
                    data-slot="bar-track"
                    aria-label={`Left to right ${percent(symmetry(letter, "vertical"))}`}
                  >
                    <span data-slot="bar" data-tone="ink" style={{ width: percent(symmetry(letter, "vertical")) }} />
                  </span>
                  <span
                    role="cell"
                    data-slot="bar-track"
                    aria-label={`Top to bottom ${percent(symmetry(letter, "horizontal"))}`}
                  >
                    <span data-slot="bar" data-tone="dark" style={{ width: percent(symmetry(letter, "horizontal")) }} />
                  </span>
                  <span data-anno>
                    {percent(symmetry(letter, "vertical"))} · {percent(symmetry(letter, "horizontal"))}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Figure>

        <Figure
          index={6}
          title="Coverage heatmap"
          note={`How many of the six letters put ink in each of the 28 positions. ${sharedPositions} positions are used by all six.`}
        >
          <div data-slot="heatmap" role="table" aria-label="Ink count per grid position">
            <For each={heatmap}>
              {(row, y) => (
                <div role="row">
                  <For each={row}>
                    {(count, x) => (
                      <span
                        role="cell"
                        style={{ "--heat": count / 6 }}
                        aria-label={`Row ${y() + 1}, column ${x() + 1}: ${count}`}
                      >
                        {count}
                      </span>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Figure>

        <Figure
          index={7}
          title="Letter frequency"
          note={`Across the ${words.length} words the six letters spell. The e carries the language.`}
        >
          <div data-slot="columns" role="table" aria-label="Letter frequency">
            <For each={letters}>
              {(letter, index) => (
                <div role="row" style={{ "--i": index() }}>
                  <span
                    data-slot="column-bar"
                    role="cell"
                    style={{ "--value": letterFrequency[letter] / maxFrequency }}
                  >
                    <span data-anno>{letterFrequency[letter]}</span>
                  </span>
                  <span role="rowheader">
                    <Mini letter={letter} />
                  </span>
                </div>
              )}
            </For>
          </div>
        </Figure>

        <Figure
          index={8}
          title="Bigrams"
          note={`Pairs of letters side by side in the word list. ‘${topBigram[0]}’ leads with ${topBigram[1]}; ${zeroBigrams} of the 36 pairs never happen.`}
        >
          <div data-slot="matrix" role="table" aria-label="Bigram counts, first letter by row">
            <div role="row">
              <span />
              <For each={letters}>
                {(letter) => (
                  <span data-anno role="columnheader">
                    {letter}
                  </span>
                )}
              </For>
            </div>
            <For each={letters}>
              {(a) => (
                <div role="row">
                  <span data-anno role="rowheader">
                    {a}
                  </span>
                  <For each={letters}>
                    {(b) => (
                      <span role="cell" style={{ "--heat": bigrams[`${a}${b}`] / maxBigram }} title={`${a}${b}`}>
                        {bigrams[`${a}${b}`]}
                      </span>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Figure>
      </div>
    </Plate>
  )
}

/** Plate: the kerning table, 36 pairs of zero. Hover or focus a pair to set it. */
export function Kerning() {
  const [pair, setPair] = createSignal<[Letter, Letter]>(["o", "d"])
  return (
    <Plate id="kerning" tone="ink" lead={fontContent.kerning.lead} aside="GPOS · kern · 0 entries">
      <div data-slot="kerning">
        <div data-slot="kern-table" role="grid" aria-label="Kerning pairs">
          <div role="row">
            <span />
            <For each={letters}>
              {(letter) => (
                <span role="columnheader" data-anno>
                  {letter}
                </span>
              )}
            </For>
          </div>
          <For each={letters}>
            {(a) => (
              <div role="row">
                <span role="rowheader" data-anno>
                  {a}
                </span>
                <For each={letters}>
                  {(b) => (
                    <button
                      type="button"
                      role="gridcell"
                      aria-label={`${a}${b}: 0 units`}
                      aria-selected={pair()[0] === a && pair()[1] === b}
                      onPointerEnter={() => setPair([a, b])}
                      onFocus={() => setPair([a, b])}
                      onClick={() => setPair([a, b])}
                    >
                      0
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
        <div data-slot="kern-pair">
          <Word text={`${pair()[0]}${pair()[1]}`} label={`The pair ${pair()[0]}${pair()[1]}`} />
          <div data-slot="kern-gap" aria-hidden="true">
            <span>120</span>
          </div>
          <p data-anno>
            {glyphNames[pair()[0]]} + {glyphNames[pair()[1]]} · adjustment 0 · gap 120u
          </p>
        </div>
        <div data-slot="kern-total" aria-hidden="true">
          <div>
            <span data-slot="numeral" data-size="xxl">
              36
            </span>
            <span data-anno>pairs</span>
          </div>
          <div>
            <span data-slot="numeral" data-size="xxl">
              0
            </span>
            <span data-anno>adjustments</span>
          </div>
        </div>
      </div>
    </Plate>
  )
}

/** Plate: sizes, counts, and a render benchmark measured live in this browser. */
export function Performance() {
  let root: HTMLDivElement | undefined
  const visible = useVisible(() => root, "0px")
  const [result, setResult] = createSignal<{ glyphs: number; ms: number }>()
  const [running, setRunning] = createSignal(false)

  const benchmark = () => {
    setRunning(true)
    // Draw every glyph as a Path2D into a canvas, many times over, and time it.
    requestAnimationFrame(() => {
      const canvas = document.createElement("canvas")
      canvas.width = 480
      canvas.height = 420
      const context = canvas.getContext("2d")!
      const paths = letters.map((letter) => ({
        ink: new Path2D(glyphs[letter].ink),
        shade: new Path2D(glyphs[letter].shadow),
      }))
      const count = 12000
      const start = window.performance.now()
      for (let index = 0; index < count; index++) {
        const path = paths[index % 6]
        context.setTransform(1, 0, 0, 1, (index % 20) * 24, (Math.floor(index / 20) % 10) * 42)
        context.fillStyle = "#cecece"
        context.fill(path.shade)
        context.fillStyle = "#141414"
        context.fill(path.ink)
      }
      context.getImageData(0, 0, 1, 1)
      setResult({ glyphs: count, ms: window.performance.now() - start })
      setRunning(false)
    })
  }

  onMount(() => {
    // Run once, the first time the plate is on screen.
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      benchmark()
    })
    if (root) observer.observe(root)
  })

  const stats = [
    { value: number(performance.otf), unit: "bytes", label: "OpenCode.otf" },
    { value: number(performance.brotli), unit: "bytes", label: "Brotli" },
    { value: number(performance.gzip), unit: "bytes", label: "Gzip" },
    { value: String(performance.glyphs), unit: "glyphs", label: "Including .notdef, .null and space" },
    { value: number(performance.codePoints), unit: "code points", label: "Mapped to six letters" },
    { value: "0", unit: "hints", label: "Every edge is on the grid" },
    { value: "0", unit: "curves", label: "Only H and V segments" },
    {
      value: String(letters.reduce((sum, letter) => sum + contours(letter).flat().length, 0)),
      unit: "points",
      label: "All six outlines",
    },
  ]

  return (
    <Plate
      id="performance"
      tone="paper"
      lead={fontContent.performance.lead}
      aside="Measured · zlib level 9, brotli default"
    >
      <div data-slot="performance" ref={root}>
        <dl data-slot="stats">
          <For each={stats}>
            {(stat) => (
              <div>
                <dd>
                  <span data-slot="numeral">{stat.value}</span>
                  <span data-anno>{stat.unit}</span>
                </dd>
                <dt>{stat.label}</dt>
              </div>
            )}
          </For>
        </dl>
        <div data-slot="benchmark" data-visible={visible() ? "" : undefined}>
          <p data-anno>Live benchmark · Canvas 2D · this device</p>
          <p data-slot="numeral" data-size="xl" aria-live="polite">
            <Show when={result()} fallback="—">
              {(value) => number(Math.round(value().glyphs / value().ms))}
            </Show>
          </p>
          <p data-anno>
            glyphs per millisecond
            <Show when={result()}>
              {(value) => ` · ${number(value().glyphs)} glyphs in ${value().ms.toFixed(1)}ms`}
            </Show>
          </p>
          <button
            type="button"
            data-component="site-button"
            data-variant="neutral"
            disabled={running()}
            onClick={benchmark}
          >
            {running() ? "Running…" : "Run again"}
          </button>
        </div>
        <div data-slot="points-table">
          <table>
            <caption data-anno>Outlines</caption>
            <thead>
              <tr>
                <th scope="col">Glyph</th>
                <th scope="col">Contours</th>
                <th scope="col">Points</th>
                <th scope="col">Segments</th>
              </tr>
            </thead>
            <tbody>
              <For each={letters}>
                {(letter) => (
                  <tr>
                    <td>{letter}</td>
                    <td>{contours(letter).length}</td>
                    <td>{contours(letter).flat().length}</td>
                    <td>{contours(letter).flat().length} straight</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <table>
            <caption data-anno>Version history</caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Date</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              <For each={versions}>
                {(version) => (
                  <tr>
                    <td>{version.version}</td>
                    <td>{version.date}</td>
                    <td>{version.note}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </Plate>
  )
}
