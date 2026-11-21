import { For, Index, Show, type JSX } from "solid-js"
import { glyphs, isLetter, modules, type Letter } from "~/lib/font-content"

export type GlyphMode = "solid" | "outline" | "grid" | "shade" | "ink"

/** One glyph's SVG as a string, for the hero's hand-built letters. */
export function glyphMarkup(letter: Letter) {
  const glyph = glyphs[letter]
  return `<svg viewBox="0 0 24 42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" shape-rendering="crispEdges"><path d="${glyph.shadow}" fill="var(--glyph-shadow)"/><path d="${glyph.ink}" fill="var(--glyph-ink)"/></svg>`
}

/**
 * Where each character of `text` sits, in cell units. Letters are 24 wide plus `gap` modules (one
 * by default); a space is three modules plus the gap.
 */
export function layout(text: string, gap = 1) {
  const items: { char: string; letter?: Letter; x: number }[] = []
  let x = 0
  for (const char of text) {
    const key = char.toLowerCase()
    items.push({ char, letter: isLetter(key) ? key : undefined, x })
    x += (char === " " ? 18 : 24) + gap * 6
  }
  return { items, width: Math.max(0, x - gap * 6) }
}

/** One glyph's content in cell units, drawn in `mode`. */
export function GlyphShape(props: { letter: Letter; mode?: GlyphMode; x?: number }) {
  const mode = () => props.mode ?? "solid"
  return (
    <g transform={props.x ? `translate(${props.x} 0)` : undefined}>
      <Show when={mode() === "grid"}>
        <Index each={modules[props.letter]}>
          {(row, y) => (
            <Index each={[...row()]}>
              {(cell, x) => (
                <rect
                  x={x * 6}
                  y={y * 6}
                  width="6"
                  height="6"
                  data-cell={cell() === "#" ? "ink" : cell() === "+" ? "shade" : "empty"}
                />
              )}
            </Index>
          )}
        </Index>
      </Show>
      <Show when={mode() === "solid" || mode() === "shade"}>
        <path d={glyphs[props.letter].shadow} data-slot="shadow" />
      </Show>
      <Show when={mode() === "solid" || mode() === "ink"}>
        <path d={glyphs[props.letter].ink} data-slot="ink" />
      </Show>
      <Show when={mode() === "outline" || mode() === "shade"}>
        <path d={glyphs[props.letter].ink} data-slot="outline" vector-effect="non-scaling-stroke" />
      </Show>
    </g>
  )
}

/**
 * A word set in the font as one SVG. Its CSS sets `--m`, the module size in pixels; the SVG is
 * `--cols` modules wide and seven high, so whole-pixel modules keep every edge crisp. Characters
 * outside the six letters show as an empty cell. Without `label` the word is decorative.
 */
export function Word(props: {
  text: string
  label?: string
  mode?: GlyphMode
  class?: string
  style?: JSX.CSSProperties
}) {
  const shape = () => layout(props.text)
  return (
    <svg
      data-component="font-word"
      class={props.class}
      viewBox={`0 0 ${shape().width} 42`}
      style={{ "--cols": shape().width / 6, ...props.style }}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
      shape-rendering="crispEdges"
    >
      <For each={shape().items}>
        {(item) => (
          <Show
            when={item.letter}
            fallback={
              <Show when={item.char !== " "}>
                <rect
                  data-slot="ghost"
                  x={item.x + 0.5}
                  y="6.5"
                  width="23"
                  height="29"
                  vector-effect="non-scaling-stroke"
                />
              </Show>
            }
          >
            {(letter) => <GlyphShape letter={letter()} mode={props.mode} x={item.x} />}
          </Show>
        )}
      </For>
    </svg>
  )
}
