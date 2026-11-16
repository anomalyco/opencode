import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { arrangements, fontContent, glyphs, isLetter, subAnagrams, words } from "~/lib/font-content"
import { CoverTitle } from "./cover-title"
import { downloadFont } from "./download"
import { layout, Word } from "./glyph"
import { useVisible } from "~/component/site/visible"
import { Plate, prefersReducedMotion, useClock } from "./plate"

const pad = (value: number, length: number) => String(value).padStart(length, "0")

/** Plate 01: the specimen's cover, like the first page of a printed type specimen. */
export function Cover() {
  const facts = [
    ["Typeface", "OpenCode"],
    ["Glyphs", "o p e n c d"],
    ["Grid", "4 × 7 modules"],
    ["Module", "120 / 1,000 em"],
    ["Format", "OpenType CFF"],
    ["Edition", "1.001"],
  ]
  return (
    <Plate id="cover" tone="paper" aside={`Edition 1.001 · ${fontContent.plates.length} plates`}>
      <div data-slot="cover">
        <div data-slot="cover-copy">
          {/* The title is set in the typeface itself, on whole-pixel modules. */}
          <p data-slot="cover-title">
            <CoverTitle />
            <span data-slot="cover-font">Font</span>
          </p>
          <p data-slot="cover-lead">{fontContent.cover.lead}</p>
          <dl data-slot="cover-facts">
            <For each={facts}>
              {(fact) => (
                <div>
                  <dt data-anno>{fact[0]}</dt>
                  <dd data-anno>{fact[1]}</dd>
                </div>
              )}
            </For>
          </dl>
        </div>
        <nav data-slot="contents" aria-label="Plates">
          <p data-anno>Contents</p>
          <ol>
            <For each={fontContent.plates}>
              {(plate, index) => (
                <li>
                  <a href={`#${plate.id}`}>
                    <span data-anno>{pad(index() + 1, 2)}</span>
                    <span>{plate.title}</span>
                  </a>
                </li>
              )}
            </For>
          </ol>
        </nav>
        <dl data-slot="cover-stats">
          <For
            each={[
              ["6", "glyphs"],
              ["28", "positions"],
              ["120", "units a module"],
              ["0", "curves"],
            ]}
          >
            {(stat) => (
              <div>
                <dd data-slot="numeral" data-size="xl">
                  {stat[0]}
                </dd>
                <dt data-anno>{stat[1]}</dt>
              </div>
            )}
          </For>
        </dl>
      </div>
    </Plate>
  )
}

/** Plate: a printed poster with crop marks, registration marks and colour bars. */
export function Poster() {
  return (
    <Plate id="poster" tone="blue" aside="Offset · 1 colour + paper">
      <div data-slot="poster" role="img" aria-label="Poster: open, code, node, done, encoded, set in the OpenCode font">
        <span data-slot="crop" data-corner="tl" />
        <span data-slot="crop" data-corner="tr" />
        <span data-slot="crop" data-corner="bl" />
        <span data-slot="crop" data-corner="br" />
        <svg data-slot="registration" viewBox="-10 -10 20 20" aria-hidden="true">
          <circle r="6" />
          <path d="M-10 0H10M0 -10V10" />
        </svg>
        <div data-slot="poster-line" data-align="start" style={{ "--cols": 19 }}>
          <Word text="open" />
          <span data-anno>Fig. 1 — open · 4 glyphs · 19 modules</span>
        </div>
        <div data-slot="poster-line" data-align="end" style={{ "--cols": 19 }}>
          <span data-anno>Fig. 2 — code · 54 ink modules</span>
          <Word text="code" />
        </div>
        <div data-slot="poster-row">
          <div style={{ "--cols": 19 }}>
            <Word text="node" />
          </div>
          <div style={{ "--cols": 19 }}>
            <Word text="done" />
          </div>
        </div>
        <div data-slot="poster-line" data-align="start" style={{ "--cols": 34 }}>
          <Word text="encoded" />
        </div>
        <div data-slot="colour-bar" aria-hidden="true">
          <span data-swatch="paper" />
          <span data-swatch="ink" />
          <span data-swatch="blue" />
          <span data-swatch="shade" />
          <span data-anno>OPC 1.001 · 100% · 50% · 0%</span>
        </div>
      </div>
    </Plate>
  )
}

const waterfallSizes = [7, 14, 21, 28, 42, 56, 84, 112, 168, 224, 280]

/** Plate: every size a multiple of seven pixels, so modules always land on whole pixels. */
export function Waterfall() {
  return (
    <Plate
      id="waterfall"
      tone="paper"
      lead="Sizes are multiples of seven pixels. At every one of them, every module is a whole number of pixels: no blur, no hinting."
      aside="7 → 280px · m = size / 7"
    >
      <ul data-slot="waterfall">
        <For each={waterfallSizes}>
          {(size) => (
            <li style={{ "--m": `${size / 7}px` }}>
              {/* A ruler of four modules at this row's size: one glyph width, alternating like a scale bar. */}
              <span data-slot="waterfall-scale">
                <span data-anno>
                  {size}px · m{size / 7}
                </span>
                <span data-slot="ruler" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
              </span>
              <div data-slot="waterfall-line">
                <Word
                  text="dependence encoded opencode deepened"
                  label={size === 84 ? "dependence encoded opencode deepened" : undefined}
                />
              </div>
            </li>
          )}
        </For>
      </ul>
    </Plate>
  )
}

/** The next arrangement of `letters` in lexicographic order, or undefined after the last. */
function nextPermutation(current: string[]) {
  const next = [...current]
  let i = next.length - 2
  while (i >= 0 && next[i] >= next[i + 1]) i--
  if (i < 0) return
  let j = next.length - 1
  while (next[j] <= next[i]) j--
  ;[next[i], next[j]] = [next[j], next[i]]
  return [...next.slice(0, i + 1), ...next.slice(i + 1).reverse()]
}

/** Plate: every arrangement of the letters of opencode, in order, and the words hiding inside. */
export function Anagrams() {
  let root: HTMLDivElement | undefined
  const visible = useVisible(() => root, "0px")
  const [motion, setMotion] = createSignal(true)
  const [playing, setPlaying] = createSignal(true)
  onMount(() => setMotion(!prefersReducedMotion()))
  const [time, setTime] = useClock(() => visible() && playing() && motion())
  // All 10,080 arrangements, computed once in the browser on first need.
  const all = createMemo(() => {
    const list: string[] = []
    let current: string[] | undefined = [..."cdeenoop"]
    while (current) {
      list.push(current.join(""))
      current = nextPermutation(current)
    }
    return list
  })
  const target = () => all().indexOf("opencode")
  const index = () => Math.floor(time() / 90) % arrangements
  const word = () => all()[index()] ?? "cdeenoop"
  const real = () => word() === "opencode"

  return (
    <Plate
      id="anagrams"
      tone="ink"
      lead={fontContent.anagrams.lead}
      aside={`8! / (2! × 2!) = ${arrangements.toLocaleString("en")}`}
    >
      <div data-slot="anagram" ref={root}>
        <div data-slot="anagram-counter">
          <span data-slot="numeral" data-size="xl">
            {pad(index() + 1, 5)}
          </span>
          <span data-anno>/ {arrangements.toLocaleString("en")}</span>
        </div>
        <div data-slot="anagram-word" data-real={real() ? "" : undefined}>
          <Word text={word()} label={word()} />
        </div>
        <div data-slot="anagram-controls">
          <span data-anno aria-live="polite">
            {real() ? "A word. The only one." : "Not a word"}
          </span>
          <button type="button" onClick={() => setPlaying(!playing())} disabled={!motion()}>
            {playing() && motion() ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMotion(true)
              setPlaying(false)
              setTime(target() * 90)
            }}
          >
            Jump to opencode (#{(target() + 1).toLocaleString("en")})
          </button>
          <button
            type="button"
            onClick={() => {
              setMotion(true)
              setPlaying(false)
              setTime((index() + 1) * 90)
            }}
          >
            Next
          </button>
        </div>
        <div data-slot="anagram-words">
          <p data-anno>
            {subAnagrams.length} words fit inside o·p·e·n·c·o·d·e — of {words.length} the letters can spell
          </p>
          <ul>
            <For each={subAnagrams}>
              {(item) => (
                <li>
                  <Word text={item} label={item} />
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </Plate>
  )
}

/** Plate: the tester. Type straight into the preview; axis-like controls; a cursor that snaps to the module grid. */
export function Tester() {
  let preview!: HTMLDivElement
  let input!: HTMLInputElement
  const [text, setText] = createSignal(fontContent.tester.initial)
  const [selection, setSelection] = createSignal<[number, number]>([text().length, text().length])
  const [focused, setFocused] = createSignal(false)
  const [overText, setOverText] = createSignal(false)
  const [size, setSize] = createSignal(10)
  const [gap, setGap] = createSignal(1)
  const [leading, setLeading] = createSignal(2)
  const [shade, setShade] = createSignal(true)
  const [outline, setOutline] = createSignal(false)
  const [grid, setGrid] = createSignal(false)
  const [cursor, setCursor] = createSignal<{ col: number; row: number }>()
  const characters = () => [...text().replace(/\s/gu, "")]
  const ghosts = () => characters().filter((char) => !isLetter(char.toLowerCase())).length

  // Words with the index of each character in the text, so the caret and clicks map to positions.
  const words = createMemo(() => {
    const result: { start: number; chars: string }[] = []
    const value = text()
    let index = 0
    while (index < value.length) {
      if (/\s/u.test(value[index])) {
        index++
        continue
      }
      const start = index
      while (index < value.length && !/\s/u.test(value[index])) index++
      result.push({ start, chars: value.slice(start, index).toLowerCase() })
    }
    return result
  })

  // Where the block caret goes: in the module just before the character at the insertion point,
  // or just after the previous character when the insertion point is a space or the end.
  const [caret, setCaret] = createSignal<{ left: number; top: number }>()
  const placeCaret = () => {
    const at = selection()[1]
    const svgs = [...preview.querySelectorAll<SVGSVGElement>("svg[data-word]")]
    const box = preview.getBoundingClientRect()
    const m = size()
    const unit = (gap() + 4) * 6
    const spot = (svg: SVGSVGElement, units: number) => {
      const rect = svg.getBoundingClientRect()
      return { left: Math.round(rect.left - box.left + (units / 6) * m), top: Math.round(rect.top - box.top) }
    }
    const list = words()
    for (const [index, word] of list.entries()) {
      if (at >= word.start && at < word.start + word.chars.length)
        return setCaret(spot(svgs[index], (at - word.start) * unit - 6))
    }
    const before = list.findLast((word) => word.start < at)
    if (before && svgs[list.indexOf(before)])
      return setCaret(
        spot(
          svgs[list.indexOf(before)],
          (Math.min(at, before.start + before.chars.length) - before.start) * unit - gap() * 6,
        ),
      )
    const first = svgs[0]
    if (first) return setCaret(spot(first, -6))
    setCaret({ left: 2 * m, top: 2 * m })
  }
  createEffect(() => {
    selection()
    words()
    size()
    gap()
    leading()
    // After the preview has laid out the new text.
    requestAnimationFrame(placeCaret)
  })

  const sync = () => setSelection([input.selectionStart ?? 0, input.selectionEnd ?? 0])
  const update = (value: string, at = value.length) => {
    setText(value)
    input.value = value
    input.setSelectionRange(at, at)
    setSelection([at, at])
  }

  // A click on a letter puts the caret on the nearer side of it; anywhere else, at the end.
  const pointerDown = (event: PointerEvent) => {
    const svg = (event.target as Element).closest<SVGSVGElement>("svg[data-word]")
    let at = text().length
    if (svg) {
      const word = words()[Number(svg.dataset.word)]
      const rect = svg.getBoundingClientRect()
      const units = ((event.clientX - rect.left) / size()) * 6
      const step = (gap() + 4) * 6
      at = word.start + Math.max(0, Math.min(word.chars.length, Math.round((units + gap() * 3) / step)))
    }
    event.preventDefault()
    input.focus({ preventScroll: true })
    input.setSelectionRange(at, at)
    sync()
  }

  const move = (event: PointerEvent) => {
    const onText = !!(event.target as Element).closest("svg[data-word]")
    setOverText(onText)
    if (onText) return setCursor(undefined)
    const rect = preview.getBoundingClientRect()
    const m = size()
    const col = Math.floor((event.clientX - rect.left - 2 * m) / m)
    const row = Math.floor((event.clientY - rect.top - 2 * m) / m)
    setCursor(col >= 0 && row >= 0 ? { col, row } : undefined)
  }

  onMount(() => {
    input.value = text()
    const selectionChange = () => {
      if (document.activeElement === input) sync()
    }
    document.addEventListener("selectionchange", selectionChange)
    onCleanup(() => document.removeEventListener("selectionchange", selectionChange))
  })

  const axes = [
    { label: "Module", min: 2, max: 32, value: size, set: setSize, unit: "px" },
    { label: "Gap", min: 0, max: 4, value: gap, set: setGap, unit: "m" },
    { label: "Leading", min: 0, max: 6, value: leading, set: setLeading, unit: "m" },
  ]
  const toggles = [
    { label: "Shade", value: shade, set: setShade },
    { label: "Outline", value: outline, set: setOutline },
    { label: "Grid", value: grid, set: setGrid },
  ]
  const selected = (index: number) => {
    const [a, b] = selection()
    return index >= Math.min(a, b) && index < Math.max(a, b)
  }

  return (
    <Plate id="tester" tone="paper" lead={fontContent.tester.lead} aside="Snap · 1 module">
      <div data-slot="tester">
        <div data-slot="tester-controls">
          <For each={axes}>
            {(axis) => (
              <label data-slot="axis">
                <span data-anno>{axis.label}</span>
                <input
                  type="range"
                  min={axis.min}
                  max={axis.max}
                  step="1"
                  value={axis.value()}
                  onInput={(event) => axis.set(Number(event.currentTarget.value))}
                />
                <output data-anno>
                  {axis.value()}
                  {axis.unit}
                </output>
              </label>
            )}
          </For>
          <div data-slot="toggles" role="group" aria-label="Layers">
            <For each={toggles}>
              {(toggle) => (
                <button type="button" aria-pressed={toggle.value()} onClick={() => toggle.set(!toggle.value())}>
                  {toggle.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div
          data-slot="tester-preview"
          ref={preview}
          data-grid={grid() ? "" : undefined}
          data-focused={focused() ? "" : undefined}
          data-over-text={overText() ? "" : undefined}
          style={{ "--m": `${size()}px`, "--gap": 3 + gap(), "--leading": leading() }}
          onPointerDown={pointerDown}
          onPointerMove={move}
          onPointerLeave={() => {
            setCursor(undefined)
            setOverText(false)
          }}
        >
          {/* The real text field: invisible, under the preview, so keyboards, paste, selection and
              screen readers all work natively. The preview draws what it holds. */}
          <input
            ref={input}
            data-slot="tester-input"
            type="text"
            maxLength={80}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            aria-label={fontContent.tester.label}
            aria-describedby="tester-readout"
            style={caret() ? { left: `${caret()!.left}px`, top: `${caret()!.top}px` } : undefined}
            onInput={(event) => {
              // Pasted line breaks and tabs become spaces; everything else is kept, and letters
              // outside the six still show as empty cells.
              const value = event.currentTarget.value
              const clean = value.replace(/[\t\r\n]/gu, " ")
              if (clean !== value) update(clean, event.currentTarget.selectionStart ?? clean.length)
              else setText(value)
              sync()
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault()
            }}
            onFocus={() => {
              setFocused(true)
              sync()
            }}
            onBlur={() => setFocused(false)}
          />
          <For each={words()}>
            {(word, index) => {
              const shape = () => layout(word.chars, gap())
              return (
                <svg
                  data-word={index()}
                  viewBox={`0 0 ${shape().width} 42`}
                  style={{ width: `${(shape().width / 6) * size()}px`, height: `${7 * size()}px` }}
                  aria-hidden="true"
                  shape-rendering="crispEdges"
                >
                  <For each={shape().items}>
                    {(item, position) => (
                      <>
                        <Show when={focused() && selected(word.start + position())}>
                          <rect data-slot="selection" x={item.x} y="0" width="24" height="42" />
                        </Show>
                        <Show
                          when={item.letter}
                          fallback={
                            <rect
                              data-slot="ghost"
                              x={item.x + 0.5}
                              y="6.5"
                              width="23"
                              height="29"
                              vector-effect="non-scaling-stroke"
                            />
                          }
                        >
                          {(letter) => (
                            <g transform={`translate(${item.x} 0)`}>
                              <Show when={shade()}>
                                <path d={glyphs[letter()].shadow} data-slot="shadow" />
                              </Show>
                              <path
                                d={glyphs[letter()].ink}
                                data-slot={outline() ? "outline" : "ink"}
                                vector-effect="non-scaling-stroke"
                              />
                            </g>
                          )}
                        </Show>
                      </>
                    )}
                  </For>
                </svg>
              )
            }}
          </For>
          <Show when={focused() && caret() && selection()[0] === selection()[1]}>
            <span
              data-slot="tester-caret"
              aria-hidden="true"
              style={{ left: `${caret()!.left}px`, top: `${caret()!.top}px` }}
            />
          </Show>
          <Show when={cursor()}>
            {(at) => (
              <span
                data-slot="snap"
                aria-hidden="true"
                style={{ left: `${(at().col + 2) * size()}px`, top: `${(at().row + 2) * size()}px` }}
              >
                <span data-anno>
                  c{at().col} r{at().row} · {at().col * 120},{at().row * 120}
                </span>
              </span>
            )}
          </Show>
        </div>
        <div data-slot="tester-footer">
          <div data-slot="presets">
            <For each={["opencode", "dependence", "coded node", "open code done", "deep need"]}>
              {(preset) => (
                <button type="button" onClick={() => update(preset)}>
                  {preset}
                </button>
              )}
            </For>
          </div>
          <span id="tester-readout" data-anno role="status">
            {characters().length - ghosts()} glyphs · {ghosts()} empty · {size() * 7}px
          </span>
        </div>
      </div>
    </Plate>
  )
}

/** Plate: the colophon, the giant last word and the download. */
export function Colophon() {
  let word!: HTMLDivElement
  const [status, setStatus] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const download = async () => {
    setBusy(true)
    setStatus("Creating your installable font.")
    setStatus(await downloadFont())
    setBusy(false)
  }
  // The page's height is rarely a whole number of pixels, so at the end of the scroll the word's
  // baseline would sit a fraction above the window's bottom edge. Add that fraction above the word.
  onMount(() => {
    let snap = 0
    const fit = () => {
      const height = document.documentElement.getBoundingClientRect().height - snap
      const next = Math.round((Math.ceil(height - 0.001) - height) * 100) / 100
      if (next === snap) return
      snap = next
      word.style.setProperty("--snap", `${snap}px`)
    }
    // Measure on the next frame, not inside the observer callback, so the adjustment never
    // re-triggers the observer within the same frame.
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(document.body)
    schedule()
    onCleanup(() => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    })
  })
  const credits = [
    ["Typeface", "OpenCode 1.001"],
    ["Drawn on", "4 × 7 modules of 120 units"],
    ["Source", "The OpenCode wordmark"],
    ["Specimen set in", "OpenCode, OpenTUI Mono and Inter"],
    ["Built with", "SVG and CSS, no images"],
    ["Published by", "Anomaly"],
  ]
  return (
    <Plate id="colophon" tone="ink" lead={fontContent.colophon.lead} aside="End of specimen">
      <div data-slot="colophon">
        <dl data-slot="credits">
          <For each={credits}>
            {(credit) => (
              <div>
                <dt data-anno>{credit[0]}</dt>
                <dd>{credit[1]}</dd>
              </div>
            )}
          </For>
        </dl>
        <div data-slot="colophon-action">
          <button type="button" data-component="site-button" disabled={busy()} aria-busy={busy()} onClick={download}>
            {fontContent.download} OpenCode.otf
          </button>
          <span data-slot="sr-only" role="status">
            {status()}
          </span>
        </div>
        <div data-slot="colophon-word" ref={word} style={{ "--cols": 19 }}>
          <Word text="done" label="done" />
        </div>
      </div>
    </Plate>
  )
}
