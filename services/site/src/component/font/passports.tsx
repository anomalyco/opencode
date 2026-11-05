import { For, Index } from "solid-js"
import {
  cellToFont,
  contours,
  counterModules,
  coverage,
  fontContent,
  glyphNames,
  letters,
  moduleCount,
  unicode,
  type Letter,
} from "~/lib/font-content"
import { GlyphShape } from "./glyph"
import { Plate } from "./plate"

/** A machine-readable zone, 44 characters a line, in the passport's spirit. */
function mrz(letter: Letter, index: number) {
  const line = (text: string) =>
    text
      .toUpperCase()
      .replace(/[^A-Z0-9<]/g, "<")
      .padEnd(44, "<")
      .slice(0, 44)
  return [
    line(`P<OPC${letter}<<${glyphNames[letter].replace(/ /g, "<")}`),
    line(
      `${unicode(letter).replace("+", "")}${index + 1}OPC${moduleCount(letter, "#")}I${moduleCount(letter, "+")}S${Math.round(coverage(letter) * 100)}C<<1001`,
    ),
  ]
}

/** Plate: an identity document for each letter, with every outline point in font units. */
export function Passports() {
  return (
    <Plate id="passports" tone="paper" lead={fontContent.passports.lead} aside="6 documents · issued 1.001">
      <div data-slot="passports">
        <For each={letters}>
          {(letter, index) => {
            const outline = contours(letter)
            return (
              <article data-slot="passport" aria-label={`Passport: ${glyphNames[letter]}`}>
                <header data-anno>
                  <span>Passport</span>
                  <span>No. {String(index() + 1).padStart(3, "0")}</span>
                </header>
                <div data-slot="passport-body">
                  <div
                    data-slot="passport-photo"
                    role="img"
                    tabIndex={0}
                    aria-label={`The letter ${letter}; focus to show its measurements`}
                  >
                    <svg viewBox="-8 -4 40 50" aria-hidden="true">
                      <g data-slot="photo-grid">
                        <Index each={Array.from({ length: 5 })}>
                          {(_, x) => <line x1={x * 6} x2={x * 6} y1="0" y2="42" />}
                        </Index>
                        <Index each={Array.from({ length: 8 })}>
                          {(_, y) => <line x1="0" x2="24" y1={y * 6} y2={y * 6} />}
                        </Index>
                      </g>
                      <GlyphShape letter={letter} />
                      <g data-slot="photo-measure">
                        <line x1="-6" x2="30" y1="6" y2="6" />
                        <line x1="-6" x2="30" y1="36" y2="36" />
                        <path d="M27.5 6V36M26.5 6H28.5M26.5 36H28.5" />
                        <text x="28.6" y="22">
                          600
                        </text>
                        <path d="M0 40.5H24M0 39.5V41.5M24 39.5V41.5" />
                        <text x="12" y="44.6" text-anchor="middle">
                          480
                        </text>
                        <text x="-6" y="5">
                          x
                        </text>
                        <text x="-6" y="35">
                          b
                        </text>
                      </g>
                    </svg>
                  </div>
                  <dl data-slot="passport-fields">
                    <div>
                      <dt data-anno>Name</dt>
                      <dd>{glyphNames[letter]}</dd>
                    </div>
                    <div>
                      <dt data-anno>Code point</dt>
                      <dd>{unicode(letter)}</dd>
                    </div>
                    <div>
                      <dt data-anno>Born</dt>
                      <dd>OpenCode wordmark</dd>
                    </div>
                    <div>
                      <dt data-anno>Ink / shade</dt>
                      <dd>
                        {moduleCount(letter, "#")} / {moduleCount(letter, "+")}
                      </dd>
                    </div>
                    <div>
                      <dt data-anno>Coverage</dt>
                      <dd>{(coverage(letter) * 100).toFixed(1)}%</dd>
                    </div>
                    <div>
                      <dt data-anno>Counter</dt>
                      <dd>{counterModules(letter)} modules</dd>
                    </div>
                    <div>
                      <dt data-anno>Contours</dt>
                      <dd>
                        {outline.length} · {outline.flat().length} points
                      </dd>
                    </div>
                  </dl>
                </div>
                <table data-slot="points">
                  <caption data-anno>Outline points, font units</caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Contour</th>
                      <th scope="col">x</th>
                      <th scope="col">y</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={outline.flatMap((points, contour) => points.map((point) => ({ point, contour })))}>
                      {(item, point) => {
                        const [x, y] = cellToFont(item.point[0], item.point[1])
                        return (
                          <tr>
                            <td>{String(point() + 1).padStart(2, "0")}</td>
                            <td>{item.contour + 1}</td>
                            <td>{x}</td>
                            <td>{y}</td>
                          </tr>
                        )
                      }}
                    </For>
                  </tbody>
                </table>
                <p data-slot="mrz" aria-hidden="true">
                  <For each={mrz(letter, index())}>{(line) => <span>{line}</span>}</For>
                </p>
              </article>
            )
          }}
        </For>
      </div>
    </Plate>
  )
}
