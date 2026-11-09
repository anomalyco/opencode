import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"
import { buildOrder, cellToFont, cells, fontContent, glyphNames, letters, type Letter } from "~/lib/font-content"
import { GlyphShape } from "./glyph"
import { clamp, ease, Plate, prefersReducedMotion } from "./plate"

const S = 10
const iso = (x: number, y: number, z: number) => [(x - y) * 0.866 * S, (x + y) * 0.5 * S - z * S] as const
const poly = (points: (readonly [number, number])[]) => points.map((point) => point.join(",")).join(" ")

type Block = { x: number; y: number; z: number; h: number; tone: "ink" | "shade"; col: number; row: number }

/**
 * The three lift rules. Each gives a module's height, in modules, at full explosion; the slider
 * scales it by e (0–1). Every rule is linear in one readable quantity, so equal steps stay equal.
 */
const rules = {
  row: {
    label: "Row",
    formula: "z = e × 180u × (6 − row)",
    note: "row = 0 at the ascender, 6 at the descender",
    unit: 1.5,
  },
  order: {
    label: "Order",
    formula: "z = e × 48u × i",
    note: "i = the order the module was placed (0 first)",
    unit: 0.4,
  },
  radius: {
    label: "Radius",
    formula: "z = e × 192u × d",
    note: "d = distance from the ink's centroid, in modules",
    unit: 1.6,
  },
} as const
type Rule = keyof typeof rules

/** Lift, in modules at e = 1, for every module of `letter` under `rule`. */
function lifts(letter: Letter, rule: Rule) {
  const ink = cells(letter, "#")
  const shade = cells(letter, "+")
  const order = buildOrder(letter)
  const cx = ink.reduce((sum, cell) => sum + cell[0] + 0.5, 0) / ink.length
  const cy = ink.reduce((sum, cell) => sum + cell[1] + 0.5, 0) / ink.length
  const lift = (cell: [number, number], tone: "ink" | "shade") => {
    if (rule === "row") return (6 - cell[1]) * rules.row.unit
    if (rule === "radius") return Math.hypot(cell[0] + 0.5 - cx, cell[1] + 0.5 - cy) * rules.radius.unit
    // Order: shade comes after the ink, in reading order, continuing the count.
    const index =
      tone === "ink"
        ? order.findIndex((item) => item[0] === cell[0] && item[1] === cell[1])
        : order.length + shade.findIndex((item) => item[0] === cell[0] && item[1] === cell[1])
    return index * rules.order.unit
  }
  return {
    centroid: [cx, cy] as const,
    order,
    items: [
      ...shade.map((cell) => ({ cell, tone: "shade" as const, lift: lift(cell, "shade") })),
      ...ink.map((cell) => ({ cell, tone: "ink" as const, lift: lift(cell, "ink") })),
    ],
  }
}

function blocks(letter: Letter, rule: Rule, explode: number): Block[] {
  return lifts(letter, rule)
    .items.map((item) => ({
      col: item.cell[0],
      row: item.cell[1],
      tone: item.tone,
      h: item.tone === "ink" ? 1 : 0.34,
      x: item.cell[0],
      y: item.cell[1],
      z: explode * item.lift,
    }))
    .sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z)
}

function Cube(props: { block: Block }) {
  const b = () => props.block
  const face = (points: [number, number, number][]) => poly(points.map(([x, y, z]) => iso(x, y, z)))
  return (
    <g data-tone={b().tone}>
      <polygon
        data-face="right"
        points={face([
          [b().x + 1, b().y, b().z],
          [b().x + 1, b().y + 1, b().z],
          [b().x + 1, b().y + 1, b().z + b().h],
          [b().x + 1, b().y, b().z + b().h],
        ])}
      />
      <polygon
        data-face="front"
        points={face([
          [b().x, b().y + 1, b().z],
          [b().x + 1, b().y + 1, b().z],
          [b().x + 1, b().y + 1, b().z + b().h],
          [b().x, b().y + 1, b().z + b().h],
        ])}
      />
      <polygon
        data-face="top"
        points={face([
          [b().x, b().y, b().z + b().h],
          [b().x + 1, b().y, b().z + b().h],
          [b().x + 1, b().y + 1, b().z + b().h],
          [b().x, b().y + 1, b().z + b().h],
        ])}
      />
    </g>
  )
}

// Light comes from behind and to the left, so shadows fall forward-right on the ground grid.
const LIGHT: [number, number] = [0.32, 0.18]

/**
 * The footprint a block's shadow covers on the ground (z = 0): at rest tight under the block,
 * higher up larger and pushed further along the light. `grow` widens it for the penumbra.
 */
function shadowQuad(b: Block, grow: number) {
  const size = 1 + grow
  const x = b.x + 0.5 + LIGHT[0] * b.z - size / 2
  const y = b.y + 0.5 + LIGHT[1] * b.z - size / 2
  return poly([iso(x, y, 0), iso(x + size, y, 0), iso(x + size, y + size, 0), iso(x, y + size, 0)])
}

/** Plate: one glyph's modules lifted into an isometric exploded view by a stated rule. */
export function Exploded() {
  let section: HTMLDivElement | undefined
  const [letter, setLetter] = createSignal<Letter>("e")
  const [rule, setRule] = createSignal<Rule>("row")
  // Starts fully exploded; scrolling through the pinned plate settles the modules flat.
  const [scroll, setScroll] = createSignal(1)
  const [manual, setManual] = createSignal<number>()
  const explode = () => manual() ?? scroll()

  onMount(() => {
    // Reduced motion: a still, half-exploded view, so the rule is still visible.
    if (prefersReducedMotion()) {
      setManual(0.5)
      return
    }
    let frame = 0
    let target = 1
    const progress = () => {
      if (!section) return 0
      const rect = section.getBoundingClientRect()
      return clamp(-rect.top / Math.max(1, rect.height - window.innerHeight))
    }
    // Lift follows scroll with an eased mapping (a short hold at each end) and a light lerp.
    const update = () => {
      frame = 0
      const next = scroll() + (target - scroll()) * 0.22
      const settled = Math.abs(target - next) < 0.001
      setScroll(settled ? target : next)
      if (!settled) frame = requestAnimationFrame(update)
    }
    const schedule = () => {
      target = 1 - ease.inOut(clamp((progress() - 0.08) / 0.8))
      // Scrolling hands the lift back from the slider.
      setManual(undefined)
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    target = 1 - ease.inOut(clamp((progress() - 0.08) / 0.8))
    setScroll(target)
    onCleanup(() => {
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      cancelAnimationFrame(frame)
    })
  })

  const shape = createMemo(() => blocks(letter(), rule(), explode()))
  const data = createMemo(() => lifts(letter(), rule()))

  // Three labelled modules, chosen to show the rule: the lowest, a middle one and the highest.
  const labels = createMemo(() => {
    const ink = data().items.filter((item) => item.tone === "ink")
    const sorted = [...ink].sort((a, b) => a.lift - b.lift || a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0])
    return [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted.at(-1)!]
  })
  const describe = (item: { cell: [number, number]; lift: number }) => {
    if (rule() === "order")
      return `i ${data().order.findIndex((cell) => cell[0] === item.cell[0] && cell[1] === item.cell[1])}`
    if (rule() === "row") return `row ${item.cell[1]}`
    return `d ${(item.lift / rules.radius.unit).toFixed(2)}`
  }

  const footprint = [
    ...Array.from({ length: 5 }, (_, x) => [iso(x, 0, 0), iso(x, 7, 0)]),
    ...Array.from({ length: 8 }, (_, y) => [iso(0, y, 0), iso(4, y, 0)]),
  ]

  return (
    <div data-slot="exploded-scroll" ref={section}>
      <Plate id="exploded" tone="paper" lead={fontContent.exploded.lead} aside="Isometric · 30°">
        <div data-slot="exploded-stage">
          <svg
            viewBox="-82 -96 172 166"
            role="img"
            aria-label={`Exploded isometric view of the letter ${letter()}, each module lifted by the rule ${rules[rule()].formula}`}
          >
            <g data-slot="footprint">
              <For each={footprint}>
                {(line) => <line x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]} />}
              </For>
              {rule() === "radius" && (
                <g data-slot="centroid">
                  <circle
                    cx={iso(data().centroid[0], data().centroid[1], 0)[0]}
                    cy={iso(data().centroid[0], data().centroid[1], 0)[1]}
                    r="1.2"
                  />
                </g>
              )}
            </g>
            {/* One shadow for the whole shape: opaque polygons in a group faded once, so overlaps
                never darken. The penumbra is a second, fainter layer of the same kind. */}
            <g data-slot="shadows" aria-hidden="true">
              <g opacity="0.08">
                <For each={shape()}>{(block) => <polygon points={shadowQuad(block, 0.22 * block.z + 0.12)} />}</For>
              </g>
              <g opacity="0.14">
                <For each={shape()}>{(block) => <polygon points={shadowQuad(block, 0.1 * block.z)} />}</For>
              </g>
            </g>
            <For each={shape()}>{(block) => <Cube block={block} />}</For>
            <For each={labels()}>
              {(item, index) => {
                const z = () => explode() * item.lift
                const anchor = () => iso(item.cell[0] + 0.5, item.cell[1] + 0.5, z() + 1)
                // Labels sit in a fixed column, highest lift at the top, so they never collide.
                const y = () => -70 + (2 - index()) * 16
                const [fx, fy] = cellToFont(item.cell[0] * 6, item.cell[1] * 6)
                return (
                  <g data-slot="leader">
                    <polyline points={poly([anchor(), [anchor()[0] + 4, y()], [46, y()]])} />
                    <circle cx={anchor()[0]} cy={anchor()[1]} r="0.7" />
                    <text x="47" y={y() + 1}>
                      ({fx}, {fy}) · {describe(item)}
                    </text>
                    <text x="47" y={y() + 4.6} data-slot="leader-sub">
                      z {Math.round(z() * 120)}u
                    </text>
                  </g>
                )
              }}
            </For>
          </svg>
          <div data-slot="exploded-controls">
            <div data-slot="letter-tabs" role="group" aria-label="Letter">
              <For each={letters}>
                {(item) => (
                  <button
                    type="button"
                    aria-pressed={letter() === item}
                    aria-label={glyphNames[item]}
                    onClick={() => setLetter(item)}
                  >
                    <svg viewBox="0 0 24 42" aria-hidden="true">
                      <GlyphShape letter={item} />
                    </svg>
                  </button>
                )}
              </For>
            </div>
            <div data-slot="toggles" role="group" aria-label="Lift rule">
              <For each={Object.keys(rules) as Rule[]}>
                {(item) => (
                  <button type="button" aria-pressed={rule() === item} onClick={() => setRule(item)}>
                    {rules[item].label}
                  </button>
                )}
              </For>
            </div>
            <div data-slot="formula">
              <p>{rules[rule()].formula}</p>
              <p data-anno>{rules[rule()].note}</p>
            </div>
            <label data-slot="axis">
              <span data-anno>e</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={explode()}
                onInput={(event) => setManual(Number(event.currentTarget.value))}
              />
              <output data-anno>{explode().toFixed(2)}</output>
            </label>
            <dl data-slot="exploded-stats">
              <div>
                <dt data-anno>Modules</dt>
                <dd>{shape().length}</dd>
              </div>
              <div>
                <dt data-anno>Top</dt>
                <dd>{Math.round(Math.max(...shape().map((block) => block.z)) * 120)}u</dd>
              </div>
            </dl>
          </div>
        </div>
      </Plate>
    </div>
  )
}
