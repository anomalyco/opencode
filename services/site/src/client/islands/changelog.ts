import { carouselDrag, revealChosenFilter, timelineRail } from "~/component/site/changelog-motion"
import { inlineKey } from "~/lib/direction"
import { $, $$, reducedMotion, t, target } from "../dom"

/**
 * The changelog and a release's page on a static page (changelog-entry.tsx, from the section that
 * holds the timeline): the filter row scrolled to the last chosen area and the timeline's rail
 * (changelog-motion.ts), each entry's media, and the heading and Copy link buttons.
 */
export default function changelog(root: HTMLElement) {
  const filter = $('[data-component="changelog-toolbar"] > [data-slot="filter"]', root)
  if (filter) revealChosenFilter(filter)
  const list = $('[data-component="changelog-timeline"]', root)
  if (list) timelineRail(list)
  $$('[data-component="changelog-entry"] > [data-slot="media"]', root).forEach(media)
  copyLinks(root)
}

// An entry's media (EntryCarousel): with several slides, dragged or swiped sideways (changelog-motion.ts),
// the bars and the arrow keys from them, and with Changelog carousel "progress" the bar that advances
// the slides; its videos play only while they are the slide showing and on screen (EntryVideo). Those
// components keep this state in signals and render it, so the slides, bars and videos are driven here
// too: change both together.
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

  carouselDrag(viewport, track, {
    count: () => count,
    index: () => index,
    go,
    drag: (offset, on) => {
      drag = offset
      dragging = on
      show()
    },
  })
}

// A heading's text copies its permalink and puts its anchor in the address bar (CopyHeading), and
// Copy link copies the entry's page (CopyLink), each rendering its state; each says "Link copied" for
// two seconds. A modified
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
