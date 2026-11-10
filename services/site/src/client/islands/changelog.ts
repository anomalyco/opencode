import { inlineKey, isRtl } from "~/lib/direction"
import { $, $$, reducedMotion, t, target } from "../dom"

/**
 * The changelog and a release's page on a static page (changelog-entry.tsx, from the section that
 * holds the timeline): the filter row scrolled to the last chosen area, the timeline's rail, each
 * entry's media, and the heading and Copy link buttons.
 */
export default function changelog(root: HTMLElement) {
  filter(root)
  const list = $('[data-component="changelog-timeline"]', root)
  if (list) timeline(list)
  $$('[data-component="changelog-entry"] > [data-slot="media"]', root).forEach(media)
  copyLinks(root)
}

// On a phone the row scrolls sideways: bring the last chosen area into view (sideways only).
function filter(root: HTMLElement) {
  const nav = $('[data-component="changelog-toolbar"] > [data-slot="filter"]', root)
  const chosen = nav && $$('[aria-current="true"]', nav).at(-1)
  if (!nav || !chosen) return
  // Right to left the row starts at the right and scrolls to negative scrollLeft values.
  nav.scrollLeft = isRtl(nav)
    ? Math.min(0, chosen.getBoundingClientRect().left - nav.getBoundingClientRect().left - 24)
    : Math.max(0, chosen.offsetLeft + chosen.offsetWidth - nav.clientWidth + 24)
}

// The rail's active and reached markers and the progress line (ChangelogTimeline), updated once a
// frame while the timeline is near the screen.
function timeline(list: HTMLElement) {
  let frame = 0
  const items = $$(":scope > li", list)
  const update = () => {
    frame = 0
    const line = innerHeight * 0.4
    // Every read before any write, so the writes never force a layout mid-loop.
    const stickyTop = items[0] ? parseFloat(getComputedStyle(items[0]).scrollMarginTop) : 0
    const rects = items.map((item) => ({
      item: item.getBoundingClientRect(),
      marker: $('[data-slot="marker"]', item)!.getBoundingClientRect(),
    }))
    const active = Math.max(
      0,
      rects.findLastIndex((rect) => rect.item.top <= stickyTop + 0.5),
    )
    items.forEach((item, index) => {
      const rect = rects[index]
      const center = rect.marker.top + rect.marker.height / 2
      item.toggleAttribute("data-active", index === active)
      item.toggleAttribute("data-reached", center <= line)
      item.style.setProperty("--fill", `${Math.max(0, Math.min(line - center, rect.item.bottom - center))}px`)
      item.style.setProperty("--fill-up", center <= line ? "100000px" : "0px")
    })
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        update()
        addEventListener("scroll", schedule, { passive: true })
        return addEventListener("resize", schedule)
      }
      cancelAnimationFrame(frame)
      frame = 0
      removeEventListener("scroll", schedule)
      removeEventListener("resize", schedule)
    },
    { rootMargin: "200px 0px" },
  ).observe(list)

  // A phone's stuck date row is held back by its title's height, so the two leave together.
  const titles = new ResizeObserver((entries) =>
    entries.forEach((entry) =>
      entry.target.closest("li")?.style.setProperty("--title-h", `${entry.borderBoxSize[0].blockSize}px`),
    ),
  )
  $$(':scope > li > [data-component="changelog-entry"] > [data-slot="title"]', list).forEach((title) =>
    titles.observe(title),
  )
}

// An entry's media (EntryCarousel): with several slides, dragged or swiped sideways, the bars and the
// arrow keys from them, and with Changelog carousel "progress" the bar that advances the slides; its
// videos play only while they are the slide showing and on screen (EntryVideo).
function media(figure: HTMLElement) {
  const viewport = $('[data-slot="viewport"]', figure)!
  const track = $('[data-slot="slides"]', figure)!
  const slides = $$('[data-slot="slide"]', track)
  const bars = $('[data-slot="bars"]', figure)
  const buttons = bars ? $$("button", bars) : []
  const counter = $('[data-slot="count"]', figure)
  const videos = slides.map((slide) => $<HTMLVideoElement>("video", slide))
  const stopped = new Set<HTMLVideoElement>()
  const count = slides.length
  let index = 0
  let visible = false
  let held = false
  let drag = 0
  let dragging = false

  const show = () => {
    track.style.setProperty("--index", String(index))
    track.style.setProperty("--drag", `${drag}px`)
    figure.toggleAttribute("data-paused", held || dragging || !visible)
    figure.toggleAttribute("data-dragging", dragging)
  }
  const go = (next: number) => {
    index = (next + count) % count
    slides.forEach((slide, position) => {
      slide.toggleAttribute("data-active", position === index)
      if (position === index) slide.removeAttribute("aria-hidden")
      if (position !== index) slide.setAttribute("aria-hidden", "true")
      slide.inert = position !== index
    })
    buttons.forEach((button, position) =>
      position === index ? button.setAttribute("aria-current", "true") : button.removeAttribute("aria-current"),
    )
    if (counter) counter.textContent = `${index + 1}/${count}`
    show()
    play()
  }
  const play = () =>
    videos.forEach((video, position) => {
      if (!video) return
      if (visible && position === index && !stopped.has(video) && !reducedMotion())
        return void video.play().catch(() => {})
      video.pause()
    })

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    show()
    play()
  }).observe(figure)
  figure.addEventListener("pointerenter", () => ((held = true), show()))
  figure.addEventListener("pointerleave", () => ((held = false), show()))
  figure.addEventListener("focusin", () => ((held = true), show()))
  figure.addEventListener("focusout", (event) => {
    if (figure.contains(event.relatedTarget as Node | null)) return
    held = false
    show()
  })

  // A video's pause and play button: pause stops it for good (WCAG 2.2.2), and play starts it again.
  videos.forEach((video) => {
    const button = video?.nextElementSibling as HTMLElement | null
    if (!video || !button) return
    const play = button.getAttribute("aria-label") ?? ""
    const label = () => {
      button.setAttribute("aria-label", video.paused ? play : (button.dataset.pause ?? play))
      $("path", button)?.setAttribute("d", video.paused ? "M3 1.5v9l7.5-4.5z" : "M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z")
    }
    video.addEventListener("play", label)
    video.addEventListener("pause", label)
    button.addEventListener("click", () => {
      if (!video.paused) {
        stopped.add(video)
        return video.pause()
      }
      stopped.delete(video)
      void video.play().catch(() => {})
    })
  })
  if (count < 2) return

  bars?.addEventListener("click", (event) => {
    const button = target(event).closest("button")
    if (button) go(buttons.indexOf(button))
  })
  // Stops the product pages' arrow-key navigation too, which skips handled events.
  bars?.addEventListener("keydown", (event) => {
    const key = inlineKey(event)
    if (key !== "ArrowLeft" && key !== "ArrowRight") return
    event.preventDefault()
    go(index + (key === "ArrowRight" ? 1 : -1))
    buttons[index]?.focus()
  })
  figure.addEventListener("animationend", (event) => target(event).matches('[data-slot="bar"]') && go(index + 1))

  // Dragging: the track follows the pointer. A gesture only becomes a drag once it is mainly
  // horizontal (touch keeps vertical scrolling through touch-action: pan-y); release past a fifth
  // of the width, or with a flick, to change slide, otherwise it snaps back.
  const gesture = {
    id: -1,
    x: 0,
    y: 0,
    offset: 0,
    axis: undefined as "x" | "y" | undefined,
    samples: [] as { x: number; t: number }[],
    clicked: false,
  }
  // The distance from one slide to the next, and where the track is now, mid-animation included.
  const step = () => Math.abs(slides[1].offsetLeft - slides[0].offsetLeft)
  // Right to left, the next slide is to the left: -1 flips the sideways maths.
  const sign = () => (isRtl(track) ? -1 : 1)
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
    const flick = event.type === "pointerup" && Math.abs(velocity) > 0.4 && Math.sign(velocity) === Math.sign(drag)
    const far = Math.abs(drag) > step() * 0.2
    const direction = (flick ? -Math.sign(velocity) : far ? -Math.sign(drag) : 0) * sign()
    const next = Math.max(0, Math.min(count - 1, index + direction))
    drag = 0
    dragging = false
    gesture.clicked = Math.abs(event.clientX - gesture.x) > 6
    if (next !== index) return go(next)
    show()
  }
  viewport.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    if (target(event).closest("button")) return
    gesture.id = event.pointerId
    gesture.x = event.clientX
    gesture.y = event.clientY
    gesture.axis = undefined
    gesture.samples = [{ x: event.clientX, t: event.timeStamp }]
  })
  viewport.addEventListener("pointermove", (event) => {
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
      gesture.offset = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41 + index * step() * sign()
      viewport.setPointerCapture(event.pointerId)
      dragging = true
    }
    if (gesture.axis !== "x") return
    gesture.samples = [
      ...gesture.samples.filter((sample) => event.timeStamp - sample.t < 100),
      { x: event.clientX, t: event.timeStamp },
    ]
    const raw = gesture.offset + dx
    // Rubber-banding past the first and last slide.
    const edge = (index === 0 && raw * sign() > 0) || (index === count - 1 && raw * sign() < 0)
    drag = edge ? raw * 0.3 : raw
    show()
  })
  viewport.addEventListener("pointerup", up)
  viewport.addEventListener("pointercancel", up)
  viewport.addEventListener("dragstart", (event) => event.preventDefault())
  // The click that ends a drag does nothing.
  viewport.addEventListener(
    "click",
    (event) => {
      if (!gesture.clicked) return
      gesture.clicked = false
      event.preventDefault()
      event.stopPropagation()
    },
    true,
  )
}

// A heading's text copies its permalink and puts its anchor in the address bar (CopyHeading), and
// Copy link copies the entry's page (CopyLink); each says "Link copied" for two seconds. A modified
// or middle click on a heading still opens its link.
function copyLinks(root: HTMLElement) {
  const timers = new WeakMap<Element, number>()
  const say = (href: string, element: Element, text: string, after: string) =>
    navigator.clipboard.writeText(href).then(() => {
      element.textContent = text
      clearTimeout(timers.get(element))
      timers.set(
        element,
        window.setTimeout(() => (element.textContent = after), 2000),
      )
    })
  root.addEventListener("click", (event) => {
    const heading = target(event).closest<HTMLAnchorElement>('[data-slot="copy-heading"]')
    if (heading) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
      event.preventDefault()
      const url = new URL(heading.href)
      history.replaceState(
        history.state,
        "",
        `#${url.hash.slice(1) || decodeURIComponent(url.pathname.split("/").at(-1)!)}`,
      )
      return void say(heading.href, $('[data-slot="copied"]', heading)!, t("changelog.share.copied"), "")
    }
    // The entry's page, which its title links to.
    const button = target(event).closest('[data-slot="copy-link"]')
    const page = button
      ?.closest('[data-component="changelog-entry"]')
      ?.querySelector<HTMLAnchorElement>(':scope > [data-slot="title"] > a')
    const label = button && $("span", button)
    if (!label || !page) return
    label.dataset.label ??= label.textContent ?? ""
    void say(page.href, label, t("changelog.share.copied"), label.dataset.label)
  })
}
