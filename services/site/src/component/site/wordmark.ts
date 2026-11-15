import { washStartTime } from "./entrance"

// The wordmark's shapes on its 234 × 42 drawing grid. "inner" paths are the counters.
const markPaths = [
  { kind: "inner", d: "M18 30H6V18H18V30Z" },
  { kind: "open", d: "M18 12H6V30H18V12ZM24 36H0V6H24V36Z" },
  { kind: "inner", d: "M48 30H36V18H48V30Z" },
  { kind: "open", d: "M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z" },
  { kind: "inner", d: "M84 24V30H66V24H84Z" },
  { kind: "open", d: "M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" },
  { kind: "inner", d: "M108 36H96V18H108V36Z" },
  { kind: "open", d: "M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z" },
  { kind: "inner", d: "M144 30H126V18H144V30Z" },
  { kind: "code", d: "M144 12H126V30H144V36H120V6H144V12Z" },
  { kind: "inner", d: "M168 30H156V18H168V30Z" },
  { kind: "code", d: "M168 12H156V30H168V12ZM174 36H150V6H174V36Z" },
  { kind: "inner", d: "M198 30H186V18H198V30Z" },
  { kind: "code", d: "M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" },
  { kind: "inner", d: "M234 24V30H216V24H234Z" },
  { kind: "code", d: "M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" },
] as const

type Point = [number, number]

// Each path's closed contours as corner points. The paths only use M, H, V and Z with absolute
// coordinates, so the corners are the points those commands land on.
function contoursOf(d: string) {
  const tokens = d.match(/[MHVZ]|-?\d+(?:\.\d+)?/g) ?? []
  const contours: Point[][] = []
  let x = 0
  let y = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === "M") {
      x = Number(tokens[++index])
      y = Number(tokens[++index])
      contours.push([])
    }
    if (token === "H") x = Number(tokens[++index])
    if (token === "V") y = Number(tokens[++index])
    if (token !== "Z") contours[contours.length - 1].push([x, y])
  }
  return contours
}

// Each letter's contours, as the entrance draws them: from the top left corner, clockwise.
const contours = markPaths.flatMap((path, index) =>
  contoursOf(path.d).map((raw) => {
    const points = raw.length > 1 && raw[0].join() === raw.at(-1)?.join() ? raw.slice(0, -1) : raw
    // Clockwise on screen (y down) has a positive shoelace sum.
    const area = points.reduce((sum, [x, y], at) => {
      const next = points[(at + 1) % points.length]
      return sum + x * next[1] - next[0] * y
    }, 0)
    const turned = area < 0 ? [...points].reverse() : points
    const corner = turned.reduce((best, point, at) => {
      const top = turned[best]
      return point[0] + point[1] < top[0] + top[1] || (point[0] + point[1] === top[0] + top[1] && point[1] < top[1])
        ? at
        : best
    }, 0)
    const ordered = [...turned.slice(corner), ...turned.slice(0, corner)]
    const lengths = ordered.map((point, at) => {
      const next = ordered[(at + 1) % ordered.length]
      return Math.abs(next[0] - point[0]) + Math.abs(next[1] - point[1])
    })
    const total = lengths.reduce((sum, length) => sum + length, 0)
    return {
      letter: Math.floor(index / 2),
      d: `M${ordered.map((point) => point.join(" ")).join("L")}Z`,
      // How far round the contour each corner is, 0 to 1.
      corners: ordered.map((point, at) => ({
        point,
        share: lengths.slice(0, at).reduce((sum, length) => sum + length, 0) / total,
      })),
    }
  }),
)

// The entrance's curve, cubic-bezier(0.65, 0, 0.35, 1), as the time at which it reaches `share`, so
// a node can appear as the outline passes it.
const CURVE = [0.65, 0, 0.35, 1] as const
function timeAt(share: number) {
  const bezier = (u: number, a: number, b: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3
  const search = (low: number, high: number, depth: number): number => {
    const middle = (low + high) / 2
    if (depth === 0) return middle
    return bezier(middle, CURVE[1], CURVE[3]) < share ? search(middle, high, depth - 1) : search(low, middle, depth - 1)
  }
  return bezier(search(0, 1, 24), CURVE[0], CURVE[2])
}

// The word's letters: each one's two paths (counter, then shape), its contours for the entrance,
// and its corners for the optional node points (each with the share of the entrance at which the
// outline reaches it). Letters sit every 30 units: 24 wide with a one-module gap.
const WORD = "opencode"
export const SLOT = 30
export const letters = [...WORD].map((char, index) => {
  const own = contours.filter((contour) => contour.letter === index)
  const reached = new Map<string, { point: Point; at: number }>()
  own.forEach((contour) =>
    contour.corners.forEach((corner) => {
      const key = corner.point.join()
      const at = timeAt(corner.share)
      if ((reached.get(key)?.at ?? 1) > at) reached.set(key, { point: corner.point, at })
    }),
  )
  return {
    char,
    paths: [markPaths[index * 2], markPaths[index * 2 + 1]],
    solid: markPaths[index * 2 + 1],
    traces: own.map((contour) => contour.d),
    corners: [...reached.values()],
  }
})
const home = letters.map((_, index) => index)
// On phones (site.css, max-width 40rem) the word stacks in two lines of COLUMNS letters, "open"
// over "code", scaled up to the full width. The lines are LINE units apart, a letter's full height,
// so the "p" descender ends level with the top of the "d" ascender. They interlock without
// touching in any order: a descender is a letter's left stem and an ascender its right.
const COLUMNS = 4
const LINE = 42
const STACKED = "(max-width: 40rem)"

// The entrance in ms at 1× speed: letter by letter, STAGGER apart, each letter's outline draws
// round from its top left corner while its hatch wipes in from the same corner, over LETTER ms on
// one curve; each node fades in as the outline passes it. CSS animations (site.css) do the motion.
const ENTRANCE = { letter: 700, stagger: 150, node: 150 }
// The share of the mark on screen that starts the entrance.
const ENTRANCE_THRESHOLD = 0.1
// A drag starts once the pointer has moved this many px sideways, more than it has moved down.
const THRESHOLD = 6
// How far past a neighbour's midpoint (in drawing units) the dragged letter goes before it gives way.
const HYSTERESIS = 3

/** The entrance's timing in ms at `speed`: each letter's, the gap between letters, and the whole. */
export function wordmarkTiming(speed: number) {
  const letter = ENTRANCE.letter / speed
  const stagger = ENTRANCE.stagger / speed
  return { letter, stagger, end: stagger * (letters.length - 1) + letter + ENTRANCE.node }
}

type Phrase =
  | "footer.wordmark.option"
  | "footer.wordmark.moved"
  | "footer.wordmark.picked"
  | "footer.wordmark.dropped"
  | "footer.wordmark.cancelled"

/**
 * What the footer wordmark does (Wordmark in marks.tsx renders it, in the app and on the static
 * pages): its entrance as it comes into view and, with `play`, its letters as a reorderable list.
 * No framework code: it drives the rendered SVG (`svg`, the mark's face) through its attributes, and
 * draws the entrance's traces into it. `t` gives the strings it announces; `onOrder` hears whether
 * the letters are out of order, once each move settles. Returns its stop.
 */
export function wordmark(
  svg: SVGSVGElement,
  options: {
    entrance: "draw" | "hatch only" | "off"
    speed: number
    play: boolean
    t: (key: Phrase, params: Record<string, string>) => string
    onOrder?: (reordered: boolean) => void
    /**
     * When the entrance plays: as the mark comes into view (the default), at once (Settings changed
     * its style or speed after it had played), or not again (it has played). `onPlay` hears it start.
     */
    start?: "view" | "now" | "played"
    onPlay?: () => void
  },
) {
  const stage = svg.querySelector<SVGGElement>('[data-slot="stage"]')!
  const groups = letters.map(
    (_, index) => stage.querySelector<SVGGElement>(`[data-slot="letter"][data-letter="${index}"]`)!,
  )
  const status = svg.parentElement?.querySelector<HTMLElement>('[data-slot="sr-only"][role="status"]')
  const timing = wordmarkTiming(options.speed)
  // The entrance: unseen until it starts, then CSS animations while "entering", then the mark.
  let phase: "waiting" | "entering" | "done" = "done"
  // The letters' order: order[slot] is the letter in that slot.
  let order = home
  // The letter being dragged with the pointer, or picked up with the keyboard (with the order before
  // it moved, for Escape). Where a dragged letter is goes straight to its transform once a frame.
  let drag: number | undefined
  let grabbed: { letter: number; before: number[] } | undefined
  // The letter that takes Tab focus (roving tabindex), and the one the pointer is pressed on, which
  // stays blue while the mark holds the capture.
  let focused = 0
  let pressed: number | undefined
  // The dragged letter while it paints last.
  let painted: number | undefined
  const slotOf = (letter: number) => order.indexOf(letter)
  const reordered = () => order.some((item, slot) => item !== home[slot])
  // Whether the word is stacked in two lines (phones), and drawing units per screen pixel there, for
  // the lift and the pointer. The stacked word is 4 letters (114 units) across the same width.
  const stacked = () => matchMedia(STACKED).matches
  const unit = () => (stacked() ? 114 : 234) / Math.max(1, svg.getBoundingClientRect().width)
  // Where a slot is in the word, in drawing units: one line, or two of COLUMNS on phones.
  const spot = (slot: number) =>
    stacked() ? { x: (slot % COLUMNS) * SLOT, y: Math.floor(slot / COLUMNS) * LINE } : { x: slot * SLOT, y: 0 }

  // The state onto the mark and its letters.
  const show = () => {
    svg.toggleAttribute("data-ready", options.play && phase === "done")
    svg.toggleAttribute("data-reordered", options.play && reordered())
    // Not data-dragging: a page-wide :has() rule (home-order.css) watches that name, so changing it
    // would restyle the whole page as a drag starts.
    svg.toggleAttribute("data-moving", drag !== undefined || !!grabbed)
    groups.forEach((group, letter) => {
      const slot = slotOf(letter)
      group.style.setProperty("--slot", String(slot))
      group.style.setProperty("--i", String(slot))
      // An empty value takes the property away.
      group.style.setProperty("--lift", grabbed?.letter === letter ? `${-2 * unit()}px` : "")
      group.toggleAttribute("data-lifted", pressed === letter || drag === letter || grabbed?.letter === letter)
      group.toggleAttribute("data-dragged", drag === letter)
      if (!options.play) return
      group.setAttribute(
        "aria-label",
        options.t("footer.wordmark.option", {
          letter: letters[letter].char,
          position: String(slot + 1),
          count: String(letters.length),
        }),
      )
      group.setAttribute("aria-selected", grabbed?.letter === letter ? "true" : "false")
      group.setAttribute("aria-posinset", String(slot + 1))
      group.tabIndex = focused === letter ? 0 : -1
    })
    // A dragged letter paints last, over the others, then goes back to its place among them.
    if (drag !== undefined && painted === undefined) stage.append(groups[(painted = drag)])
    if (drag === undefined && painted !== undefined) stage.insertBefore(groups[painted], groups[painted + 1] ?? null)
    if (drag === undefined) painted = undefined
    if (drag === undefined && !grabbed) options.onOrder?.(reordered())
  }
  const place = (letter: number, slot: number) => {
    const next = order.filter((item) => item !== letter)
    next.splice(Math.max(0, Math.min(letters.length - 1, slot)), 0, letter)
    order = next
  }
  const say = (key: Phrase, letter: number) => {
    if (status)
      status.textContent = options.t(key, { letter: letters[letter].char, position: String(slotOf(letter) + 1) })
  }

  // The pointer pressed on a letter, until it is released: where it went down, the letter and its
  // element, the order then, and drawing units per screen pixel (measured once, at the press).
  let origin:
    | { x: number; y: number; id: number; letter: number; slot: number; before: number[]; unit: number }
    | undefined
  let pointerX = 0
  let pointerY = 0
  let frame = 0
  const pointerDown = (letter: number, event: PointerEvent) => {
    if (!options.play || phase !== "done" || event.button !== 0) return
    origin = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      letter,
      slot: slotOf(letter),
      before: order,
      unit: unit(),
    }
    // Captured on the mark, not the letter, so the letter can move to the top while it is dragged.
    svg.setPointerCapture(event.pointerId)
    // A press does not focus the letter: focus restyles the page (its :has(:focus-visible) rules) mid-drag.
    event.preventDefault()
    pressed = letter
    show()
  }
  const pointerMove = (event: PointerEvent) => {
    if (!origin || event.pointerId !== origin.id) return
    pointerX = event.clientX
    pointerY = event.clientY
    if (drag === origin.letter) {
      frame ||= requestAnimationFrame(follow)
      return
    }
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    // Down first means scrolling (or nothing), not a drag.
    if (Math.abs(dy) > THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
      origin = undefined
      pressed = undefined
      return show()
    }
    if (Math.abs(dx) < THRESHOLD) return
    drag = origin.letter
    follow()
  }
  // Once a frame: the dragged letter to the pointer (whole pixels, lifted 2px), and the letters it
  // passes to their new slots. A neighbour gives way once the dragged letter is half way into its
  // slot (or, stacked, half way into the other line), plus HYSTERESIS, so nothing flickers back and
  // forth around a midpoint. The order is one list read line by line, so a letter moved into the top
  // line pushes that line's last letter down to the start of the bottom line, as text reflows.
  const follow = () => {
    frame = 0
    if (!origin || drag !== origin.letter) return
    const start = spot(origin.slot)
    const x = start.x + Math.round(pointerX - origin.x) * origin.unit
    const y = start.y + Math.round(pointerY - origin.y) * origin.unit
    groups[origin.letter].style.transform = `translate3d(${x - origin.letter * SLOT}px, ${y - 2 * origin.unit}px, 0)`
    const lines = stacked() ? letters.length / COLUMNS : 1
    const columns = letters.length / lines
    const current = slotOf(origin.letter)
    const nearest = (position: number, at: number, size: number, count: number) => {
      const forward = Math.floor((position - size / 2 - HYSTERESIS) / size) + 1
      const back = Math.ceil((position + size / 2 + HYSTERESIS) / size) - 1
      return Math.max(0, Math.min(count - 1, forward > at ? forward : back < at ? back : at))
    }
    const line = nearest(y, Math.floor(current / columns), LINE, lines)
    const column = nearest(x, current % columns, SLOT, columns)
    const slot = line * columns + column
    if (slot !== current) place(origin.letter, slot)
    show()
  }
  const pointerUp = () => {
    const held = origin
    origin = undefined
    cancelAnimationFrame(frame)
    frame = 0
    pressed = undefined
    if (!held || drag === undefined) return show()
    // The letter eases from where it was let go into its slot (its transition, in site.css).
    groups[held.letter].style.removeProperty("transform")
    drag = undefined
    show()
    if (held.before.some((item, slot) => item !== order[slot])) say("footer.wordmark.moved", held.letter)
  }

  const keydown = (letter: number, event: KeyboardEvent) => {
    if (!options.play || phase !== "done") return
    const slot = slotOf(letter)
    const held = grabbed
    // Stacked on phones, up and down move between the lines.
    const line = stacked() ? COLUMNS : 0
    const direction =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -line
            : event.key === "ArrowDown"
              ? line
              : 0
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      grabbed = held ? undefined : { letter, before: order }
      show()
      return say(held ? "footer.wordmark.dropped" : "footer.wordmark.picked", letter)
    }
    if (event.key === "Escape" && held) {
      event.preventDefault()
      order = held.before
      grabbed = undefined
      show()
      return say("footer.wordmark.cancelled", letter)
    }
    if (!direction && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? letters.length - 1 : Math.max(0, Math.min(7, slot + direction))
    if (held || event.altKey) {
      if (target === slot) return
      place(letter, target)
      show()
      return say("footer.wordmark.moved", letter)
    }
    focused = order[target]
    show()
    groups[focused].focus()
  }

  // Plays the entrance after `delay` ms. On "entering" with "draw", each letter gets dashed copies
  // of its contours (pathLength 1), which site.css draws in place of its outline.
  let timers: ReturnType<typeof setTimeout>[] = []
  const enter = (next: typeof phase) => {
    phase = next
    attribute(svg, "data-state", phase === "done" ? undefined : phase)
    attribute(svg, "data-entrance", phase === "entering" ? options.entrance : undefined)
    svg.querySelectorAll('[data-slot="trace"]').forEach((trace) => trace.remove())
    if (phase === "entering" && options.entrance === "draw")
      groups.forEach((group, letter) =>
        letters[letter].traces.forEach((d) => {
          const trace = document.createElementNS("http://www.w3.org/2000/svg", "path")
          trace.setAttribute("d", d)
          trace.setAttribute("pathLength", "1")
          trace.dataset.slot = "trace"
          group.insertBefore(trace, group.querySelector("rect"))
        }),
      )
    show()
  }
  const play = (delay: number) => {
    options.onPlay?.()
    timers.forEach(clearTimeout)
    enter("waiting")
    timers = [
      setTimeout(
        () => {
          svg.style.setProperty("--wm-hairline", `${unit()}px`)
          enter("entering")
          timers.push(setTimeout(() => enter("done"), timing.end))
        },
        Math.max(16, delay),
      ),
    ]
  }

  const listening = new AbortController()
  const signal = listening.signal
  if (options.play) {
    svg.addEventListener("pointermove", pointerMove, { signal })
    svg.addEventListener("pointerup", pointerUp, { signal })
    svg.addEventListener("pointercancel", pointerUp, { signal })
    groups.forEach((group, letter) => {
      group.addEventListener("pointerdown", (event) => pointerDown(letter, event), { signal })
      group.addEventListener("keydown", (event) => keydown(letter, event), { signal })
      group.addEventListener(
        "focus",
        () => {
          focused = letter
          show()
        },
        { signal },
      )
      group.addEventListener(
        "blur",
        () => {
          if (grabbed?.letter !== letter) return
          grabbed = undefined
          show()
        },
        { signal },
      )
    })
  }
  svg.toggleAttribute("data-mounted", true)
  show()
  // Starts as the mark comes into view (a tenth of it on screen), so the drawing is under way while
  // it scrolls in. Already in view at load (a short page), it waits for first paint.
  let first = true
  const observer = new IntersectionObserver(
    (entries) => {
      const initial = first
      first = false
      if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= ENTRANCE_THRESHOLD)) return
      observer.disconnect()
      play(washStartTime(initial) - performance.now())
    },
    { threshold: ENTRANCE_THRESHOLD },
  )
  const start =
    options.entrance === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "played"
      : (options.start ?? "view")
  if (start === "now") play(0)
  if (start === "view") {
    enter("waiting")
    observer.observe(svg)
  }

  return () => {
    observer.disconnect()
    timers.forEach(clearTimeout)
    cancelAnimationFrame(frame)
    listening.abort()
    // The entrance's state goes; the next run shows the rest with its own options.
    svg.querySelectorAll('[data-slot="trace"]').forEach((trace) => trace.remove())
    svg.removeAttribute("data-state")
    svg.removeAttribute("data-entrance")
  }
}

function attribute(element: Element, name: string, value: string | undefined) {
  if (value === undefined) return element.removeAttribute(name)
  element.setAttribute(name, value)
}
