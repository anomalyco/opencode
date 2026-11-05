import "./sticky-title.css"
import { createEffect, on, onCleanup, onMount } from "solid-js"
import { siteSettings } from "./settings"
import { isRtl } from "~/lib/direction"

/**
 * A page's title (h1). With Settings › Sticky title, it stops in the breadcrumb row as the page
 * scrolls and shrinks to the breadcrumb's size, then hands over to a crisp copy of the title at
 * that size, over a bar the content passes under. A scroll-driven animation on the title's
 * view timeline does this where supported; elsewhere a scroll listener sets the same values each
 * frame. Only transform and opacity change, so the title keeps its space and nothing reflows.
 */
export function PageTitle(props: { title: string }) {
  let title!: HTMLHeadingElement
  let bar!: HTMLDivElement
  let current!: HTMLSpanElement

  onMount(() => {
    const scripted = !CSS.supports("animation-timeline", "view()")
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
    const end = { start: 0, range: 0, x: 0, y: 0, scale: 1 }
    let frame = 0

    // The title's place in the row at the end, from untransformed boxes. The text's own box (not the
    // h1's line box) lines up with the copy's text, so the baselines meet.
    const measure = () => {
      if (!title.hasAttribute("data-sticky")) {
        if (scripted) update()
        return
      }
      title.style.animation = "none"
      title.style.transform = "none"
      const box = title.getBoundingClientRect()
      const text = textBox(title)
      const copy = textBox(current)
      const row = current.parentElement!.getBoundingClientRect()
      title.style.animation = ""
      title.style.transform = ""
      end.scale = parseFloat(getComputedStyle(current).fontSize) / parseFloat(getComputedStyle(title).fontSize)
      end.range = parseFloat(getComputedStyle(title).getPropertyValue("--sticky-range"))
      end.start = box.top + window.scrollY - row.top
      // The title scales from its inline-start corner (sticky-title.css), so the start edges meet.
      end.x = isRtl(title)
        ? copy.right - box.right - end.scale * (text.right - box.right)
        : copy.left - box.left - end.scale * (text.left - box.left)
      end.y = copy.top - row.top - end.scale * (text.top - box.top)
      title.style.setProperty("--sticky-x", `${end.x}px`)
      title.style.setProperty("--sticky-y", `${end.y}px`)
      title.style.setProperty("--sticky-scale", `${end.scale}`)
      bar.style.setProperty("--sticky-left", `${box.left}px`)
      bar.style.setProperty("--sticky-width", `${box.width}px`)
      if (scripted) update()
    }

    const update = () => {
      frame = 0
      if (!title.hasAttribute("data-sticky")) {
        ;[title, bar, current].forEach((element) => element.removeAttribute("style"))
        return
      }
      const raw = (window.scrollY - end.start) / end.range
      const stuck = raw >= 0
      const progress = reduce.matches ? (stuck ? 1 : 0) : Math.min(1, Math.max(0, raw))
      const fade = (from: number) => `${Math.max(0, (progress - from) / (1 - from))}`
      title.style.transform =
        reduce.matches || !stuck
          ? ""
          : `translate(${end.x * progress}px, ${(end.range + end.y) * progress}px) scale(${1 + (end.scale - 1) * progress})`
      title.style.opacity = reduce.matches ? "" : `${1 - Number(fade(0.85))}`
      title.style.pointerEvents = progress === 1 ? "none" : ""
      bar.style.visibility = stuck ? "visible" : ""
      bar.style.opacity = stuck ? `${Math.min(1, progress / 0.25)}` : ""
      current.style.opacity = fade(0.85)
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(measure)
    resize.observe(title)
    window.addEventListener("resize", measure)
    if (scripted) window.addEventListener("scroll", schedule, { passive: true })
    createEffect(
      on(
        () => siteSettings.stickyTitle,
        () => requestAnimationFrame(measure),
        { defer: true },
      ),
    )
    measure()
    onCleanup(() => {
      resize.disconnect()
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", schedule)
      cancelAnimationFrame(frame)
    })
  })

  return (
    <>
      <h1
        ref={title}
        data-component="page-title"
        data-design="stickyTitle"
        data-sticky={siteSettings.stickyTitle === "off" ? undefined : siteSettings.stickyTitle}
      >
        {props.title}
      </h1>
      <div ref={bar} data-component="sticky-title" aria-hidden="true">
        <div>
          <span ref={current} data-slot="current">
            {props.title}
          </span>
        </div>
      </div>
    </>
  )
}

function textBox(element: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range.getClientRects()[0] ?? element.getBoundingClientRect()
}
