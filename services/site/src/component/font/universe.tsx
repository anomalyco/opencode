import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { designCopy, designEditing } from "~/component/site/design-copy"
import { clamp, Plate, prefersReducedMotion } from "./plate"

// 6^3591 = 10^(3591 × log10 6) = 10^2794.34…, a 2,795-digit number. At about 10^80 atoms a
// universe, 34 nested levels give 10^2720 (short) and 35 give 10^2800, the first to pass it.
const EXPONENT = 3591 * Math.log10(6)
const PER_LEVEL = 80
const LEVELS = Math.ceil(EXPONENT / PER_LEVEL)

const STORY = [
  "Every visit maps 3,591 characters to six letters.",
  "That makes 6³⁵⁹¹ possible fonts, a number 2,795 digits long.",
  "The observable universe holds about 10⁸⁰ atoms.",
  "Put a whole universe inside every one of those atoms.",
  "Then a universe inside every atom of those, and keep going.",
  "34 levels down there are 10²⁷²⁰ atoms. Still short.",
  "At level 35 there are 10²⁸⁰⁰, finally more than 6³⁵⁹¹.",
  "Your font is one of them.",
].join("\n")

// Within a sentence's share of the scroll: words light up over the first READ of it, and it
// hands over to the next sentence in the last FADE.
const READ = 0.7
const FADE = 0.1

const superscript = (value: number | string) =>
  String(value).replace(/[0-9.]/g, (digit) => (digit === "." ? "·" : "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(digit)]))
const isNumber = (word: string) => /[0-9⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(word)
const smooth = (u: number) => u * u * (3 - 2 * u)

// The nested squares: a universe is a square, its atom a small filled square at its centre (1/K of
// its side, at ATOM), among faint specks. Each level zooms into the atom from the centre until it
// is the next universe, which looks exactly like the last, so the loop has no seam: everything
// grows out of the centre, each level holding the next.
const K = 10
const ATOM = [0.5 - 0.5 / K, 0.5 - 0.5 / K] as const

// The site's strong ease-out, cubic-bezier(0.23, 1, 0.32, 1) (--ease-out), for things arriving: the
// new universe's atom and specks as they spread from its centre.
function easeOut(t: number) {
  const [x1, y1, x2, y2] = [0.23, 1, 0.32, 1]
  const curve = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3
  // Solve x(u) = t by bisection, then return y(u).
  let low = 0
  let high = 1
  for (let step = 0; step < 20; step++) {
    const u = (low + high) / 2
    if (curve(x1, x2, u) < t) low = u
    else high = u
  }
  return curve(y1, y2, (low + high) / 2)
}
const SPECKS = Array.from({ length: 36 }, (_, index) => {
  const x = (Math.sin(index * 12.9898) * 43758.5453) % 1
  const y = (Math.sin(index * 78.233) * 12543.123) % 1
  return [0.08 + Math.abs(x) * 0.84, 0.08 + Math.abs(y) * 0.84] as const
}).filter((point) => Math.hypot(point[0] - ATOM[0] - 0.05, point[1] - ATOM[1] - 0.05) > 0.12)

/** Draws level `value` (1–35, fractional while zooming) into `canvas`, at `alpha`. */
function drawNesting(canvas: HTMLCanvasElement, value: number, alpha: number) {
  const dpr = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)))
  const width = Math.round(canvas.clientWidth * dpr)
  const height = Math.round(canvas.clientHeight * dpr)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const context = canvas.getContext("2d")!
  context.clearRect(0, 0, width, height)
  if (alpha <= 0) return
  const narrow = width / dpr < 640
  // Desktop: the right half, beside the story. Narrow: low in the frame, under the story.
  const side = Math.round(narrow ? Math.min(width * 0.46, height * 0.26) : Math.min(width * 0.28, height * 0.46))
  const cx = Math.round(narrow ? width / 2 : width * 0.74)
  const cy = Math.round(narrow ? height - 5.5 * 16 * dpr - side * 0.75 : height * 0.5)
  const level = Math.min(LEVELS, Math.floor(value))
  const w = level >= LEVELS ? 0 : smooth(value - level)
  const grow = Math.pow(K, w)
  const along = (grow - 1) / (K - 1)
  const atomCentre = [ATOM[0] + 0.5 / K, ATOM[1] + 0.5 / K]
  const fx = 0.5 + (atomCentre[0] - 0.5) * along
  const fy = 0.5 + (atomCentre[1] - 0.5) * along
  const scale = side * grow
  const at = (x: number, y: number) => [Math.round(cx + (x - fx) * scale), Math.round(cy + (y - fy) * scale)] as const
  const line = Math.max(1, Math.round(dpr))
  context.fillStyle = "#fff"
  context.strokeStyle = "#fff"
  context.lineWidth = line

  /**
   * One universe: its outline, its specks and its atom, in the frame [ox, oy] + [0, size]. `spread`
   * (0–1) grows it out of its centre: the atom from a point, then the specks outward from the
   * middle, the nearest first.
   */
  const universe = (
    ox: number,
    oy: number,
    size: number,
    outline: number,
    specks: number,
    atom: number,
    spread = 1,
  ) => {
    const [x0, y0] = [Math.round(cx + (ox - fx) * scale), Math.round(cy + (oy - fy) * scale)]
    const px = Math.round(size * scale)
    if (outline > 0) {
      context.globalAlpha = alpha * outline
      context.strokeRect(x0 + line / 2, y0 + line / 2, px - line, px - line)
    }
    if (specks > 0) {
      const dot = Math.max(line, Math.round(2 * dpr))
      for (const point of SPECKS) {
        // A speck leaves the centre once the spread reaches its distance from it (half the spread
        // is that stagger), then eases out to its place.
        const distance = Math.hypot(point[0] - 0.5, point[1] - 0.5) / Math.SQRT1_2
        const own = easeOut(clamp((spread - distance * 0.5) / 0.5))
        if (own <= 0) continue
        context.globalAlpha = alpha * specks * 0.4 * own
        const x = 0.5 + (point[0] - 0.5) * own
        const y = 0.5 + (point[1] - 0.5) * own
        context.fillRect(Math.round(x0 + x * px), Math.round(y0 + y * px), dot, dot)
      }
    }
    if (atom > 0) {
      // The atom grows from the centre point first.
      const grown = easeOut(clamp(spread / 0.5))
      const atomPx = Math.max(line, Math.round((px / K) * grown))
      context.globalAlpha = alpha * atom * grown
      context.fillRect(Math.round(x0 + px / 2 - atomPx / 2), Math.round(y0 + px / 2 - atomPx / 2), atomPx, atomPx)
    }
  }

  const fade = clamp((w - 0.35) / 0.45)
  const opened = clamp((w - 0.5) / 0.5)
  // The parent universe fades as we enter its atom; the atom empties into an outline and fills
  // with the next universe's specks and atom.
  universe(0, 0, 1, 1 - fade, 1 - fade, 0)
  const [ax, ay] = at(ATOM[0], ATOM[1])
  const atomSide = Math.max(line, Math.round(scale / K))
  // The atom hollows out early in the zoom, so a large white fill never floods the frame.
  context.globalAlpha = alpha * (1 - clamp(w * 4))
  context.fillRect(ax, ay, atomSide, atomSide)
  if (w > 0) {
    context.globalAlpha = alpha * clamp(w * 4)
    context.strokeRect(ax + line / 2, ay + line / 2, atomSide - line, atomSide - line)
    universe(ATOM[0], ATOM[1], 1 / K, 0, opened, opened, opened)
  }

  // The ticks: one per level, lit up to this one.
  const top = Math.round(cy + side / 2 + 20 * dpr)
  const left = Math.round(cx - side / 2)
  const gap = (side - line) / (LEVELS - 1)
  for (let index = 0; index < LEVELS; index++) {
    context.globalAlpha = alpha * (index < level ? 1 : 0.3)
    context.fillRect(Math.round(left + index * gap), top, line, Math.round((index % 5 === 4 ? 10 : 6) * dpr))
  }
  context.globalAlpha = 1
}

/** The still diagram: five universes, each drawn inside the atom of the one before (at the centre), enlarged. */
function drawDiagram(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)))
  canvas.width = Math.round(canvas.clientWidth * dpr)
  canvas.height = Math.round(canvas.clientHeight * dpr)
  const context = canvas.getContext("2d")!
  const line = Math.max(1, Math.round(dpr))
  const side = Math.round(Math.min(canvas.width, canvas.height) * 0.86)
  context.strokeStyle = "#fff"
  context.fillStyle = "#fff"
  context.lineWidth = line
  let x = Math.round((canvas.width - side) / 2)
  let y = Math.round((canvas.height - side) / 2)
  let size = side
  for (let index = 0; index < 5; index++) {
    context.globalAlpha = 1 - index * 0.12
    context.strokeRect(x + line / 2, y + line / 2, size - line, size - line)
    context.globalAlpha = 0.4
    const dot = Math.max(line, Math.round(2 * dpr))
    for (const point of SPECKS)
      context.fillRect(Math.round(x + point[0] * size), Math.round(y + point[1] * size), dot, dot)
    // Each inner universe is drawn at 3× its atom, centred like it, so the nesting stays visible.
    const next = Math.round(size * 0.26)
    x = Math.round(x + (size - next) / 2)
    y = Math.round(y + (size - next) / 2)
    size = next
  }
  context.globalAlpha = 1
}

/**
 * How big is 6^3591, told as a story on a blue stage. The plate pins while its track scrolls
 * past; one sentence at a time, its words light up as you scroll. A counter and the nested squares
 * step through the 35 levels between the sentences that name 10^80 and 10^2800. Only opacity,
 * transform and the canvas change per frame. Reduced motion: no pinning, the whole story lit, and
 * a still diagram of the nesting.
 */
export function Universe() {
  let track!: HTMLDivElement
  let story!: HTMLDivElement
  let counter!: HTMLDivElement
  let canvas!: HTMLCanvasElement
  const [level, setLevel] = createSignal(1)
  const sentences = () => designCopy("font.universe.story", STORY).split("\n")
  const editing = () => designEditing("font.universe.story")

  onMount(() => {
    if (prefersReducedMotion()) {
      setLevel(LEVELS)
      drawDiagram(canvas)
      const resize = new ResizeObserver(() => drawDiagram(canvas))
      resize.observe(canvas)
      onCleanup(() => resize.disconnect())
      return
    }
    let frame = 0
    let shown = 0
    let target = 0
    let visible = false
    // Last written values, so a frame only touches what changed.
    const written = new WeakMap<HTMLElement, string>()
    const write = (element: HTMLElement, key: string, value: string) => {
      if (written.get(element) === key + value) return
      written.set(element, key + value)
      if (key === "lit") element.toggleAttribute("data-lit", value === "1")
      else if (key === "active") element.toggleAttribute("data-active", value === "1")
      else element.style.setProperty(key, value)
    }

    const render = (q: number) => {
      if (editing()) return
      const items = [...story.querySelectorAll<HTMLElement>('[data-slot="universe-sentence"]')]
      const share = 1 / items.length
      const local = (index: number) => (q - index * share) / share
      items.forEach((item, index) => {
        const t = local(index)
        // One sentence shows at a time, in place: the next takes over half a fade before its share
        // starts, and CSS crossfades the two in the same spot (universe-sentence in font/index.css).
        const active =
          index === 0 ? t < 1 - FADE / 2 : t >= -FADE / 2 && (index === items.length - 1 || t < 1 - FADE / 2)
        write(item, "active", active ? "1" : "0")
        const words = [...item.querySelectorAll<HTMLElement>('[data-slot="universe-word"]')]
        const read = clamp(t / READ) * words.length
        words.forEach((word, position) => {
          const lit = clamp(read - position)
          write(word, "opacity", (0.35 + 0.65 * lit).toFixed(3))
          write(word, "lit", lit > 0.5 ? "1" : "0")
        })
      })
      // The counter: level 1 once 10⁸⁰ is read, 34 at 10²⁷²⁰ (if named), 35 at 10²⁸⁰⁰.
      const texts = items.map((item) => item.textContent ?? "")
      const anchors = (
        [
          [texts.findIndex((text) => text.includes("10⁸⁰")), 1],
          [texts.findIndex((text) => text.includes("10²⁷²⁰")), 34],
          [texts.findIndex((text) => text.includes("10²⁸⁰⁰")), LEVELS],
        ] as const
      )
        .filter((anchor) => anchor[0] >= 0)
        .map((anchor) => [(anchor[0] + READ) * share, anchor[1]] as const)
      if (anchors.length < 2) {
        write(counter, "opacity", "0")
        return drawNesting(canvas, 1, 0)
      }
      const start = anchors[0][0] - READ * share
      const appear = clamp((q - start) / (share * 0.3))
      write(counter, "opacity", appear.toFixed(3))
      const next = anchors.findIndex((anchor) => q < anchor[0])
      const value =
        next === -1
          ? anchors.at(-1)![1]
          : next === 0
            ? 1
            : anchors[next - 1][1] +
              ((anchors[next][1] - anchors[next - 1][1]) * (q - anchors[next - 1][0])) /
                (anchors[next][0] - anchors[next - 1][0])
      const whole = Math.max(1, Math.min(LEVELS, Math.floor(value)))
      if (level() !== whole) setLevel(whole)
      drawNesting(canvas, value, appear)
    }

    const progress = () => {
      const rect = track.getBoundingClientRect()
      return clamp(-rect.top / Math.max(1, rect.height - window.innerHeight))
    }
    const step = () => {
      frame = 0
      const next = shown + (target - shown) * 0.25
      shown = Math.abs(target - next) < 0.0005 ? target : next
      render(shown)
      if (shown !== target) frame = requestAnimationFrame(step)
    }
    const schedule = () => {
      if (!visible) return
      target = progress()
      if (!frame) frame = requestAnimationFrame(step)
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        if (!visible) return
        shown = target = progress()
        render(shown)
      },
      { rootMargin: "200px 0px" },
    )
    observer.observe(track)
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    // A resize clears the canvas, so draw the current frame again.
    const resize = new ResizeObserver(() => visible && render(shown))
    resize.observe(canvas)
    onCleanup(() => {
      resize.disconnect()
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    })
  })

  return (
    <Plate id="universe" tone="paper" aside={`${LEVELS} levels · 10${superscript(PER_LEVEL)} atoms each`}>
      <div data-slot="universe">
        <div data-slot="universe-track" ref={track}>
          <div data-slot="universe-stage">
            <canvas data-slot="universe-nesting" ref={canvas} aria-hidden="true" />
            <div data-slot="universe-counter" aria-hidden="true" ref={counter}>
              <span data-anno>
                Level {String(level()).padStart(2, "0")} / {LEVELS}
              </span>
              <span data-slot="universe-power">
                10<sup>{(level() * PER_LEVEL).toLocaleString("en")}</sup>
              </span>
              <span data-anno>
                atoms
                <Show when={level() === LEVELS}> · more than 6³⁵⁹¹ ≈ 10²⁷⁹⁴·³</Show>
              </span>
            </div>
            <div
              data-slot="universe-story"
              data-design-copy="font.universe.story"
              data-editing={editing() ? "" : undefined}
              ref={story}
            >
              <For each={sentences()}>
                {(sentence) => (
                  <p data-slot="universe-sentence">
                    <Show when={!editing()} fallback={sentence}>
                      <For each={sentence.split(" ")}>
                        {(word, index) => (
                          <>
                            {index() > 0 && " "}
                            <span data-slot="universe-word" data-number={isNumber(word) ? "" : undefined}>
                              {word}
                            </span>
                          </>
                        )}
                      </For>
                    </Show>
                  </p>
                )}
              </For>
            </div>
          </div>
        </div>
        <div data-slot="universe-notes">
          <p data-slot="universe-working" data-anno>
            <span>log₁₀ 6 = 0.778151…</span>
            <span>3,591 × 0.778151… = {EXPONENT.toFixed(2)}</span>
            <span>
              6³⁵⁹¹ ≈ 10{superscript(EXPONENT.toFixed(2))} · {(Math.floor(EXPONENT) + 1).toLocaleString("en")} digits
            </span>
            <span>
              {EXPONENT.toFixed(2)} ÷ 80 = {(EXPONENT / PER_LEVEL).toFixed(2)} → {LEVELS} levels (10²⁷²⁰ is short,
              10²⁸⁰⁰ passes)
            </span>
          </p>
        </div>
      </div>
    </Plate>
  )
}
