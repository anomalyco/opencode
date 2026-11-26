import { isRtl } from "~/lib/direction"

// The changelog's motion (changelog-entry.tsx), with no Solid, so the hydrated pages and the static
// changelog pages (src/client/islands/changelog.ts) run the same code.

/** On a phone the filter row scrolls sideways: brings the last chosen area into view (sideways only). */
export function revealChosenFilter(nav: HTMLElement) {
  const chosen = [...nav.querySelectorAll<HTMLElement>('[aria-current="true"]')].at(-1)
  if (!chosen) return
  // Right to left the row starts at the right and scrolls to negative scrollLeft values.
  nav.scrollLeft = isRtl(nav)
    ? Math.min(0, chosen.getBoundingClientRect().left - nav.getBoundingClientRect().left - 24)
    : Math.max(0, chosen.offsetLeft + chosen.offsetWidth - nav.clientWidth + 24)
}

/**
 * The timeline's rail (ChangelogTimeline): the active and reached markers and the progress line,
 * updated once a frame while the timeline is near the screen, and each entry's title height for a
 * phone's stuck date row. Returns the function that stops it.
 */
export function timelineRail(list: HTMLElement) {
  let frame = 0
  const update = () => {
    frame = 0
    const line = innerHeight * 0.4
    // Read each time: the hydrated changelog swaps its entries in place when a filter changes.
    const items = [...list.querySelectorAll<HTMLElement>(":scope > li")]
    // Every read before any write, so the writes never force a layout mid-loop.
    // The sticky top line (each entry's scroll-margin-top is the same --content-top). The active
    // entry is the one whose date is stuck there, or would be with sticky off: the last entry
    // whose top has reached it, else the first.
    const stickyTop = items[0] ? parseFloat(getComputedStyle(items[0]).scrollMarginTop) : 0
    const rects = items.map((item) => ({
      item: item.getBoundingClientRect(),
      marker: item.querySelector('[data-slot="marker"]')!.getBoundingClientRect(),
    }))
    const active = Math.max(
      0,
      rects.findLastIndex((rect) => rect.item.top <= stickyTop + 0.5),
    )
    // Both marker styles are kept current, so switching the setting needs no scroll. --fill is
    // how far the progress line runs down this entry's rail, from its marker's centre.
    items.forEach((item, index) => {
      const rect = rects[index]
      const center = rect.marker.top + rect.marker.height / 2
      item.toggleAttribute("data-active", index === active)
      item.toggleAttribute("data-reached", center <= line)
      item.style.setProperty("--fill", `${Math.max(0, Math.min(line - center, rect.item.bottom - center))}px`)
      // Once this marker is passed, the line above it (up to the page top, clipped) is covered too.
      item.style.setProperty("--fill-up", center <= line ? "100000px" : "0px")
    })
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  const stop = () => {
    cancelAnimationFrame(frame)
    frame = 0
    removeEventListener("scroll", schedule)
    removeEventListener("resize", schedule)
  }
  const near = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return stop()
      update()
      addEventListener("scroll", schedule, { passive: true })
      addEventListener("resize", schedule)
    },
    { rootMargin: "200px 0px" },
  )
  near.observe(list)

  // A phone's stuck date row is held back by its title's height, so the two leave together.
  const titles = new ResizeObserver((entries) =>
    entries.forEach((entry) =>
      entry.target.closest("li")?.style.setProperty("--title-h", `${entry.borderBoxSize[0].blockSize}px`),
    ),
  )
  list
    .querySelectorAll(':scope > li > [data-component="changelog-entry"] > [data-slot="title"]')
    .forEach((title) => titles.observe(title))
  return () => {
    near.disconnect()
    titles.disconnect()
    stop()
  }
}

/**
 * Dragging an entry's media (EntryCarousel): the track follows the pointer. A gesture only becomes a
 * drag once it is mainly horizontal (touch keeps vertical scrolling through touch-action: pan-y);
 * release past a fifth of the width, or with a flick, to change slide, otherwise it snaps back. The
 * carousel keeps its own state: `drag` gets the track's offset from the current slide while a drag
 * runs, and `go` the slide it lands on. Returns the function that stops it.
 */
export function carouselDrag(
  viewport: HTMLElement,
  track: HTMLElement,
  carousel: {
    count: () => number
    index: () => number
    go: (index: number) => void
    drag: (offset: number, dragging: boolean) => void
  },
) {
  const gesture = {
    id: -1,
    x: 0,
    y: 0,
    offset: 0,
    drag: 0,
    axis: undefined as "x" | "y" | undefined,
    samples: [] as { x: number; t: number }[],
    clicked: false,
  }
  // The distance from one slide to the next, and where the track is now, mid-animation included.
  const step = () => {
    const slides = track.children
    return slides.length > 1
      ? Math.abs((slides[1] as HTMLElement).offsetLeft - (slides[0] as HTMLElement).offsetLeft)
      : 1
  }
  // Right to left, the next slide is to the left: -1 flips the sideways maths.
  const sign = () => (isRtl(track) ? -1 : 1)

  const down = (event: PointerEvent) => {
    if (carousel.count() < 2 || (event.pointerType === "mouse" && event.button !== 0)) return
    if ((event.target as Element).closest("button")) return
    gesture.id = event.pointerId
    gesture.x = event.clientX
    gesture.y = event.clientY
    gesture.axis = undefined
    gesture.samples = [{ x: event.clientX, t: event.timeStamp }]
  }
  const move = (event: PointerEvent) => {
    if (event.pointerId !== gesture.id) return
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    if (!gesture.axis) {
      if (Math.hypot(dx, dy) < 6) return
      // A mouse has no page to scroll by dragging, so any direction drags.
      if (event.pointerType !== "mouse" && Math.abs(dy) >= Math.abs(dx)) {
        gesture.axis = "y"
        return
      }
      gesture.axis = "x"
      // Picks the track up where it is, so a drag can catch a slide that is still moving.
      gesture.offset = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41 + carousel.index() * step() * sign()
      viewport.setPointerCapture(event.pointerId)
    }
    if (gesture.axis !== "x") return
    gesture.samples = [
      ...gesture.samples.filter((sample) => event.timeStamp - sample.t < 100),
      { x: event.clientX, t: event.timeStamp },
    ]
    const raw = gesture.offset + dx
    // Rubber-banding past the first and last slide.
    const index = carousel.index()
    const edge = (index === 0 && raw * sign() > 0) || (index === carousel.count() - 1 && raw * sign() < 0)
    gesture.drag = edge ? raw * 0.3 : raw
    carousel.drag(gesture.drag, true)
  }
  const up = (event: PointerEvent) => {
    if (event.pointerId !== gesture.id) return
    gesture.id = -1
    if (gesture.axis !== "x") return
    // The speed over the last 100ms before release, so a pointer that stopped first doesn't flick.
    const recent = [...gesture.samples, { x: event.clientX, t: event.timeStamp }].filter(
      (sample) => event.timeStamp - sample.t < 100,
    )
    const first = recent[0]
    const last = recent[recent.length - 1]
    const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0
    // A flick moves on in the direction the pointer was going, if the drag went that way too.
    const flick =
      event.type === "pointerup" && Math.abs(velocity) > 0.4 && Math.sign(velocity) === Math.sign(gesture.drag)
    const far = Math.abs(gesture.drag) > step() * 0.2
    const direction = (flick ? -Math.sign(velocity) : far ? -Math.sign(gesture.drag) : 0) * sign()
    const next = Math.max(0, Math.min(carousel.count() - 1, carousel.index() + direction))
    gesture.drag = 0
    gesture.clicked = Math.abs(event.clientX - gesture.x) > 6
    carousel.drag(0, false)
    if (next !== carousel.index()) carousel.go(next)
  }
  const stop = new AbortController()
  const on = { signal: stop.signal }
  viewport.addEventListener("pointerdown", down, on)
  viewport.addEventListener("pointermove", move, on)
  viewport.addEventListener("pointerup", up, on)
  viewport.addEventListener("pointercancel", up, on)
  viewport.addEventListener("dragstart", (event) => event.preventDefault(), on)
  // The click that ends a drag does nothing.
  viewport.addEventListener(
    "click",
    (event) => {
      if (!gesture.clicked) return
      gesture.clicked = false
      event.preventDefault()
      event.stopPropagation()
    },
    { ...on, capture: true },
  )
  return () => stop.abort()
}
