import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, onMount, Show } from "solid-js"
import { useI18n } from "~/context/i18n-context"
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
const SLOT = 30
const letters = [...WORD].map((char, index) => {
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

/**
 * The footer wordmark: outlined letters with a light diagonal hatch, like a technical drawing.
 * `hatch` is the gap between hatch lines in drawing units; `nodes` adds a small square on every
 * corner, like anchor points in a vector editor. `entrance` plays once the mark scrolls into view
 * (a tenth of it on screen): letter by letter, "draw" draws each letter's outline round from its
 * top left corner while its hatch wipes in from there, each node fading in as the outline passes
 * it; "hatch only" starts from the drawn outlines. Reduced motion shows the mark.
 *
 * On phones the word stacks in two lines, "open" over "code" (CSS only, so it is stacked from the
 * server's markup).
 *
 * With `play`, the letters are a reorderable list: drag one sideways (or pick it up with Space and
 * move it with the arrow keys, and up and down between the lines on phones) and the others slide
 * aside, each into a letter slot. A move that
 * settles reports through `onOrder` whether the word is out of order (the footer then shows a line
 * about the font) and turns the whole mark blue. The letter under the pointer, in focus or in hand
 * stands out: it is blue and the others dim.
 */
export function Wordmark(props: {
  hatch?: number
  nodes?: boolean
  entrance?: "draw" | "hatch only" | "off"
  speed?: number
  play?: boolean
  /** Called with whether the letters are out of their "opencode" order, once each move settles. */
  onOrder?: (reordered: boolean) => void
}) {
  let svg!: SVGSVGElement
  const i18n = useI18n()
  const instructions = createUniqueId()
  // Each mark's own hatch patterns: with a fixed id, every mark on the page would paint the first
  // mark's pattern, whose lines take that mark's colours (a light pane's grey in a dark one).
  const pattern = `mark-hatch-${createUniqueId()}`
  const hatch = () => props.hatch ?? 2.5
  const node = 0.9
  const entrance = () => props.entrance ?? "off"
  const [mounted, setMounted] = createSignal(false)
  // The entrance: unseen until it starts, then CSS animations while "entering", then the mark.
  const [phase, setPhase] = createSignal<"waiting" | "entering" | "done">("done")
  // The outline's hairline in drawing units (1 screen px), measured as the entrance starts: the
  // entrance's outlines are dashed, and dashes go wrong on a non-scaling stroke.
  const [hairline, setHairline] = createSignal(1)

  const timing = createMemo(() => {
    const speed = props.speed ?? 1
    const letter = ENTRANCE.letter / speed
    const stagger = ENTRANCE.stagger / speed
    return { letter, stagger, end: stagger * (letters.length - 1) + letter + ENTRANCE.node }
  })

  // The letters' order: order()[slot] is the letter in that slot.
  const [order, setOrder] = createSignal(home)
  const slotOf = (letter: number) => order().indexOf(letter)
  // The letter being dragged with the pointer, or picked up with the keyboard (with the order
  // before it moved, for Escape). Only which letter is dragged is a signal, set once per drag; where
  // it is goes straight to its transform once a frame, with no re-render.
  const [drag, setDrag] = createSignal<number>()
  const [grabbed, setGrabbed] = createSignal<{ letter: number; before: number[] }>()
  // The letter that takes Tab focus (roving tabindex).
  const [focused, setFocused] = createSignal(0)
  const [announcement, setAnnouncement] = createSignal("")
  const playable = () => !!props.play && mounted() && phase() === "done"
  const reordered = () => order().some((item, slot) => item !== home[slot])
  // The letters in paint order: a dragged letter goes last, so it draws over the others.
  const painted = () => {
    const dragged = drag()
    return dragged === undefined ? home : [...home.filter((letter) => letter !== dragged), dragged]
  }
  // The letter the pointer is pressed on stays blue while the mark holds the capture.
  const [pressed, setPressed] = createSignal<number>()
  const lifted = (letter: number) => pressed() === letter || drag() === letter || grabbed()?.letter === letter
  // Whether the word is stacked in two lines (phones), and drawing units per screen pixel there, for
  // the lift and the pointer. The stacked word is 4 letters (114 units) across the same width.
  const stacked = () => window.matchMedia(STACKED).matches
  const unit = () => (stacked() ? 114 : 234) / Math.max(1, svg.getBoundingClientRect().width)
  // Where a slot is in the word, in drawing units: one line, or two of COLUMNS on phones.
  const spot = (slot: number) =>
    stacked() ? { x: (slot % COLUMNS) * SLOT, y: Math.floor(slot / COLUMNS) * LINE } : { x: slot * SLOT, y: 0 }

  const place = (letter: number, slot: number) => {
    const next = order().filter((item) => item !== letter)
    next.splice(Math.max(0, Math.min(letters.length - 1, slot)), 0, letter)
    setOrder(next)
  }
  const say = (key: Parameters<typeof i18n.t>[0], letter: number) =>
    setAnnouncement(i18n.t(key, { letter: letters[letter].char, position: slotOf(letter) + 1 }))
  const moved = (letter: number) => {
    say("footer.wordmark.moved", letter)
  }

  createEffect(() => {
    if (drag() !== undefined || grabbed()) return
    props.onOrder?.(reordered())
  })

  createEffect(() => {
    if (props.play) return
    setOrder(home)
    setDrag(undefined)
    setGrabbed(undefined)
  })

  // The pointer pressed on a letter, until it is released: where it went down, the letter and its
  // element, the order then, and drawing units per screen pixel (measured once, at the press).
  let origin:
    | {
        x: number
        y: number
        id: number
        letter: number
        slot: number
        before: number[]
        unit: number
        element: SVGGElement
      }
    | undefined
  let pointerX = 0
  let pointerY = 0
  let frame = 0
  const pointerDown = (letter: number, event: PointerEvent) => {
    if (!playable() || event.button !== 0) return
    const element = event.currentTarget as SVGGElement
    origin = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      letter,
      slot: slotOf(letter),
      before: order(),
      unit: unit(),
      element,
    }
    // Captured on the mark, not the letter, so the letter can move to the top while it is dragged.
    svg.setPointerCapture(event.pointerId)
    // A press does not focus the letter: focus restyles the page (its :has(:focus-visible) rules) mid-drag.
    event.preventDefault()
    setPressed(letter)
  }
  const pointerMove = (event: PointerEvent) => {
    if (!origin || event.pointerId !== origin.id) return
    pointerX = event.clientX
    pointerY = event.clientY
    if (drag() === origin.letter) {
      frame ||= requestAnimationFrame(follow)
      return
    }
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    // Down first means scrolling (or nothing), not a drag.
    if (Math.abs(dy) > THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
      origin = undefined
      setPressed(undefined)
      return
    }
    if (Math.abs(dx) < THRESHOLD) return
    setDrag(origin.letter)
    follow()
  }
  // Once a frame: the dragged letter to the pointer (whole pixels, lifted 2px), and the letters it
  // passes to their new slots. A neighbour gives way once the dragged letter is half way into its
  // slot (or, stacked, half way into the other line), plus HYSTERESIS, so nothing flickers back and
  // forth around a midpoint. The order is one list read line by line, so a letter moved into the top
  // line pushes that line's last letter down to the start of the bottom line, as text reflows.
  const follow = () => {
    frame = 0
    if (!origin || drag() !== origin.letter) return
    const start = spot(origin.slot)
    const x = start.x + Math.round(pointerX - origin.x) * origin.unit
    const y = start.y + Math.round(pointerY - origin.y) * origin.unit
    origin.element.style.transform = `translate3d(${x - origin.letter * SLOT}px, ${y - 2 * origin.unit}px, 0)`
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
  }
  const pointerUp = () => {
    const held = origin
    origin = undefined
    cancelAnimationFrame(frame)
    frame = 0
    setPressed(undefined)
    if (!held || drag() === undefined) return
    // The letter eases from where it was let go into its slot (its transition, in site.css).
    held.element.style.removeProperty("transform")
    setDrag(undefined)
    if (held.before.some((item, slot) => item !== order()[slot])) moved(held.letter)
  }

  const keydown = (letter: number, event: KeyboardEvent) => {
    if (!playable()) return
    const slot = slotOf(letter)
    const held = grabbed()
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
      if (held) {
        setGrabbed(undefined)
        return say("footer.wordmark.dropped", letter)
      }
      setGrabbed({ letter, before: order() })
      return say("footer.wordmark.picked", letter)
    }
    if (event.key === "Escape" && held) {
      event.preventDefault()
      setOrder(held.before)
      setGrabbed(undefined)
      return say("footer.wordmark.cancelled", letter)
    }
    if (!direction && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? letters.length - 1 : Math.max(0, Math.min(7, slot + direction))
    if (held || event.altKey) {
      if (target === slot) return
      place(letter, target)
      if (held) return say("footer.wordmark.moved", letter)
      return moved(letter)
    }
    focusSlot(target)
  }
  const focusSlot = (slot: number) => {
    setFocused(order()[slot])
    svg.querySelector<SVGGElement>(`[data-slot="letter"][data-letter="${order()[slot]}"]`)?.focus()
  }

  // Plays the entrance after `delay` ms. Out of "entering" for a frame first, so a replay restarts
  // the CSS animations.
  let timers: ReturnType<typeof setTimeout>[] = []
  let played = false
  const play = (delay: number) => {
    played = true
    timers.forEach(clearTimeout)
    setPhase("waiting")
    timers = [
      setTimeout(
        () => {
          setHairline(unit())
          setPhase("entering")
          timers.push(setTimeout(() => setPhase("done"), timing().end))
        },
        Math.max(16, delay),
      ),
    ]
  }
  onCleanup(() => timers.forEach(clearTimeout))

  onMount(() => {
    setMounted(true)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    createEffect(() => {
      if (entrance() === "off") {
        timers.forEach(clearTimeout)
        played = false
        setPhase("done")
        return
      }
      if (played) return
      setPhase("waiting")
      // Starts as the mark comes into view (a tenth of it on screen), so the drawing is under way
      // while it scrolls in. Already in view at load (a short page), it waits for first paint.
      let first = true
      const observer = new IntersectionObserver(
        (entries) => {
          const initial = first
          first = false
          if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= ENTRANCE_THRESHOLD)) return
          observer.disconnect()
          if (!played) play(washStartTime(initial) - performance.now())
        },
        { threshold: ENTRANCE_THRESHOLD },
      )
      observer.observe(svg)
      onCleanup(() => observer.disconnect())
    })
    // A changed style or speed plays the entrance again, once it has played.
    createEffect(
      on(
        () => [entrance(), props.speed],
        () => {
          if (played && entrance() !== "off") play(0)
        },
        { defer: true },
      ),
    )
  })

  return (
    <>
      <svg
        viewBox="0 0 234 42"
        preserveAspectRatio="xMinYMin meet"
        data-slot="face"
        data-mounted={mounted() ? "" : undefined}
        data-state={phase() === "done" ? undefined : phase()}
        data-entrance={phase() === "entering" ? entrance() : undefined}
        style={{
          "--wm-letter": `${timing().letter}ms`,
          "--wm-stagger": `${timing().stagger}ms`,
          "--wm-hairline": `${hairline()}px`,
          "--wm-pattern": `url(#${pattern})`,
          "--wm-pattern-active": `url(#${pattern}-active)`,
        }}
        data-play={props.play ? "" : undefined}
        data-reordered={props.play && reordered() ? "" : undefined}
        data-ready={playable() ? "" : undefined}
        // Not data-dragging: a page-wide :has() rule (home-order.css) watches that name, so changing
        // it would restyle the whole page as a drag starts.
        data-moving={drag() !== undefined || grabbed() ? "" : undefined}
        role={props.play ? "listbox" : "img"}
        aria-label={props.play ? i18n.t("footer.wordmark.letters") : i18n.t("footer.wordmark.name")}
        aria-describedby={props.play ? instructions : undefined}
        aria-orientation={props.play ? "horizontal" : undefined}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        ref={svg}
      >
        <defs>
          <pattern
            id={pattern}
            width={hatch()}
            height={hatch()}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2={hatch()} />
          </pattern>
          <Show when={props.play}>
            <pattern
              id={`${pattern}-active`}
              width={hatch()}
              height={hatch()}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2={hatch()} data-slot="active" />
            </pattern>
          </Show>
        </defs>
        <g data-slot="stage">
          <For each={painted()}>
            {(index) => (
              <g
                data-slot="letter"
                data-letter={index}
                data-lifted={lifted(index) ? "" : undefined}
                data-dragged={drag() === index ? "" : undefined}
                style={{
                  "--slot": slotOf(index),
                  "--home": index,
                  "--i": slotOf(index),
                  "--lift": grabbed()?.letter === index ? `${-2 * unit()}px` : undefined,
                }}
                role={props.play ? "option" : undefined}
                aria-roledescription={props.play ? i18n.t("footer.wordmark.roleLetter") : undefined}
                aria-label={
                  props.play
                    ? i18n.t("footer.wordmark.option", {
                        letter: letters[index].char,
                        position: slotOf(index) + 1,
                        count: letters.length,
                      })
                    : undefined
                }
                aria-selected={props.play ? (grabbed()?.letter === index ? "true" : "false") : undefined}
                aria-posinset={props.play ? slotOf(index) + 1 : undefined}
                aria-setsize={props.play ? letters.length : undefined}
                tabindex={props.play ? (focused() === index ? 0 : -1) : undefined}
                onFocus={() => setFocused(index)}
                onBlur={() => {
                  if (grabbed()?.letter === index) setGrabbed(undefined)
                }}
                onKeyDown={(event) => keydown(index, event)}
                onPointerDown={(event) => pointerDown(index, event)}
              >
                <path d={letters[index].solid.d} data-slot="fill" />
                <For each={letters[index].paths}>{(path) => <path d={path.d} data-slot="outline" />}</For>
                <Show when={phase() === "entering" && entrance() === "draw"}>
                  <For each={letters[index].traces}>{(d) => <path d={d} pathLength="1" data-slot="trace" />}</For>
                </Show>
                <Show when={props.nodes}>
                  <For each={letters[index].corners}>
                    {(corner) => (
                      <rect
                        data-slot="node"
                        style={{ "--at": corner.at.toFixed(3) }}
                        x={corner.point[0] - node / 2}
                        y={corner.point[1] - node / 2}
                        width={node}
                        height={node}
                      />
                    )}
                  </For>
                </Show>
                <Show when={props.play}>
                  <rect data-slot="focus" x={index * SLOT - 3} y="-3" width="30" height="48" />
                </Show>
              </g>
            )}
          </For>
        </g>
      </svg>
      <Show when={props.play}>
        <span data-slot="sr-only" id={instructions}>
          {i18n.t("footer.wordmark.instructions")}
        </span>
        <span data-slot="sr-only" role="status">
          {announcement()}
        </span>
      </Show>
    </>
  )
}

export function LogoIcon() {
  return (
    <svg data-slot="icon" width="24" height="30" viewBox="0 0 240 300" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M180 240H60V120H180V240Z" data-slot="inner" />
      <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" data-slot="code" />
    </svg>
  )
}

export function Logo() {
  return (
    <svg width="117" height="21" viewBox="0 0 234 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 30H6V18H18V30Z" data-slot="inner" />
      <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" data-slot="open" />
      <path d="M48 30H36V18H48V30Z" data-slot="inner" />
      <path d="M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z" data-slot="open" />
      <path d="M84 24V30H66V24H84Z" data-slot="inner" />
      <path d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" data-slot="open" />
      <path d="M108 36H96V18H108V36Z" data-slot="inner" />
      <path d="M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z" data-slot="open" />
      <path d="M144 30H126V18H144V30Z" data-slot="inner" />
      <path d="M144 12H126V30H144V36H120V6H144V12Z" data-slot="code" />
      <path d="M168 30H156V18H168V30Z" data-slot="inner" />
      <path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" data-slot="code" />
      <path d="M198 30H186V18H198V30Z" data-slot="inner" />
      <path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" data-slot="code" />
      <path d="M234 24V30H216V24H234Z" data-slot="inner" />
      <path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" data-slot="code" />
    </svg>
  )
}

/** The Anomaly signature logo, drawn in the current text colour. */
export function AnomalyLogo() {
  return (
    <svg data-slot="anomaly" viewBox="0 0 1600 608" fill="currentColor" role="img" aria-label="Anomaly">
      <path d="M1362.56 230.14C1350.97 232.967 1309.57 260.185 1285.19 276.81C1307.39 220.489 1366.24 84.0599 1391.46 41.0841C1397.02 31.6219 1390.14 5.68564 1377.61 20.8403C1357.48 45.1932 1309.27 123.907 1274.24 192.291C1272.24 186.259 1266.68 182.603 1263.51 182.603C1257.15 182.603 1245.19 185.392 1230.7 189.728C1241.12 147.242 1251.21 109.77 1252.83 96.9527C1253.2 94.0122 1253.35 90.7702 1252.83 89.1115C1251.55 85.304 1243.91 75.3894 1243.91 75.3894C1243.91 75.3894 1244.59 72.9014 1244.17 70.7526C1242.44 60.9511 1231.08 51.4889 1226.37 56.6158C1181.59 105.699 1096.66 225.541 1072.96 295.584C1069.27 306.441 1064.3 321.256 1067.16 329.814C1069.16 335.808 1079.05 337.316 1084.47 337.202C1090.15 331.661 1099.03 318.693 1106.49 304.292C1114.54 288.798 1124.02 271.532 1134.22 253.664C1149.57 246.991 1170.12 238.471 1190.81 230.064C1189.57 238.471 1188.63 245.785 1188.14 251.289C1185.21 285.481 1195.29 302.256 1198.11 302.256C1199.88 302.256 1204.36 298.826 1206.88 294.717C1206.88 294.717 1209.59 289.25 1210.19 285.556C1213.65 264.332 1218.77 240.281 1224.34 216.493C1245.98 207.823 1264.12 200.66 1271.49 197.757C1249.89 240.432 1233.94 278.318 1233.94 295.282C1233.94 313.905 1258.13 323.066 1288.8 315.677C1320.3 299.957 1371.17 261.731 1389.35 250.836C1393.49 243.372 1381.15 225.616 1362.56 230.14ZM1155.59 217.021C1174.93 184.563 1194.69 153.047 1210.38 129.712C1204.89 153.198 1199.66 178.871 1195.59 201.452C1181.82 206.428 1167.9 211.856 1155.59 217.021Z" />
      <path d="M1585.66 56.7665C1558.98 68.943 1496.89 138.081 1445 201.829C1431.98 165.073 1409.86 116.254 1387.73 107.772C1381.37 108.488 1367.11 117.762 1373.05 132.54C1375.84 139.476 1403.87 205.222 1416.63 237.717C1377.8 288.233 1344.83 337.429 1330.95 369.17C1321.35 391.148 1333.13 408.414 1352.32 406.378C1421.03 294.151 1554.84 117.498 1600 62.7605C1600 62.7605 1594.96 52.5443 1585.7 56.7665H1585.66Z" />
      <path d="M1074.8 93.0697C1055.61 115.689 1023.77 156.591 994.649 199.303C1010.3 137.101 1037.02 28.1536 1037.02 20.7648C1037.02 10.5863 1009.89 -5.62378 1003.68 1.95353C924.432 98.6868 790.771 374.26 766.011 487.09C769.096 498.437 782.041 492.443 785.917 483.81C815.268 418.178 915.401 228.067 972.485 125.189C956.907 181.208 938.92 253.136 937.866 277.564C936.963 298.826 946.258 310.097 955.101 310.097C960.707 310.097 967.895 299.316 971.432 294.302C988.742 269.685 1020.2 223.053 1045.45 187.503C1032.69 237.68 1017.83 299.504 1014.56 329.738C1012.9 345.006 1030.4 356.466 1033.48 349.756C1052.45 308.363 1109.68 142.228 1114.01 115.99C1116.98 98.0836 1081.01 85.8317 1074.8 93.1452V93.0697Z" />
      <path d="M697.449 23.1021C697.449 23.1021 617.373 228.368 584.635 295.508C583.694 247.293 586.366 170.238 588.022 146.789C589.226 129.524 556.074 142.379 552.876 144.716C529.997 177.589 502.151 225.088 476.976 271.834C475.321 269.421 473.326 267.951 471.031 268.064C460.231 268.63 444.841 270.288 426.364 272.739C458.124 176.232 488.943 76.4449 493.609 47.9451C496.469 30.5286 464.22 2.14208 438.594 5.4972C396.863 47.7944 296.918 182.452 207.961 312.736C127.207 330.756 50.7061 351.641 12.7752 370.414C-0.658606 382.666 -6.03969 409.47 9.31327 412.071C39.3042 403.174 100.979 392.053 160.961 382.779C107.527 463.868 63.8765 535.834 48.7493 572.476C44.5724 591.627 49.3138 619.9 61.28 602.635C106.172 537.756 165.289 455.574 225.233 373.393C274.077 366.758 311.556 362.875 313.023 364.684C316.711 369.321 323.334 449.43 321.716 482.566L321.377 483.81C321.377 494.139 351.519 482.83 354.83 475.781C363.071 458.251 386.326 392.656 411.501 317.486C425.8 315.224 440.927 312.736 456.92 309.947C430.428 361.668 410.183 406.831 407.738 422.212C405.254 437.894 416.919 450.523 421.698 442.267C464.747 367.851 515.998 286.649 552.085 228.632C549.451 280.919 550.204 359.897 555.171 374.901C559.912 389.339 589.49 377.2 594.532 372.299C616.508 350.887 702.718 103.474 710.507 42.3659C712.238 28.6438 704.298 8.17374 697.562 23.0268L697.449 23.1021ZM431.068 94.9546C412.629 158.137 393.927 220.791 376.806 280.128C347.605 284.877 314.792 290.758 280.85 297.431C338.16 219.547 392.234 146.827 431.03 94.9546H431.068ZM343.503 400.234C343.767 370.603 341.471 352.998 340.23 345.571C339.063 338.371 324.086 334.677 302.826 333.659C322.28 330.681 342.412 327.853 364.049 324.687C356.674 350.811 349.788 376.107 343.466 400.271L343.503 400.234Z" />
      <path d="M867.122 194.101C873.971 129.788 780.122 121.569 718.146 146.299C718.146 156.365 734.778 156.327 744.788 155.121C745.051 155.121 745.277 155.083 745.54 155.045C705.163 186.146 651.391 245.785 651.391 294.754C651.391 319.974 688.456 339.389 706.706 339.389C759.501 339.389 861.515 246.689 867.085 194.101H867.122ZM699.03 313.377C697.562 275.227 760.667 185.317 791.787 153.387C812.22 155.875 820.499 164.96 822.192 182.867C822.192 221.469 743.696 296.866 699.03 313.415V313.377Z" />
    </svg>
  )
}
