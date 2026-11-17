import { makeEventListener } from "@solid-primitives/event-listener"

function target(event: Event) {
  const anchor = event.target instanceof Element ? event.target.closest("a") : null

  if (!(anchor instanceof HTMLAnchorElement) || !anchor.closest("[data-pane-row]")) return
  const href = anchor.dataset.appLink

  if (!href || /^[a-z]:[\\/]/i.test(href)) return
  const protocol = URL.parse(href)?.protocol

  if (!protocol || /^(https?|file):$/.test(protocol)) return

  return { anchor, href }
}

function modified(event: MouseEvent | KeyboardEvent) {
  return event.metaKey || event.shiftKey || event.ctrlKey || event.altKey
}

export function createAppLinks(review: (href: string) => void) {
  let pressed: ReturnType<typeof target>
  makeEventListener(
    document,
    "pointerdown",
    (event) => {
      pressed = event.isTrusted && event.button === 0 && !modified(event) ? target(event) : undefined
    },
    true,
  )
  makeEventListener(
    document,
    "pointercancel",
    () => {
      pressed = undefined
    },
    true,
  )
  makeEventListener(
    document,
    "keydown",
    (event) => {
      if (event.key !== "Enter") return
      const link = target(event)

      if (!link) return
      event.preventDefault()
      event.stopImmediatePropagation()

      if (event.isTrusted && !modified(event) && !event.repeat && link.anchor === document.activeElement) review(link.href)
    },
    true,
  )

  const click = (event: MouseEvent) => {
    const start = pressed
    pressed = undefined
    const link = target(event)

    if (!link) return
    event.preventDefault()
    event.stopImmediatePropagation()

    // A stream can replace the anchor or change its target between press and release.
    if (event.type !== "click" || !event.isTrusted || modified(event) || event.button !== 0) return
    const paired = event.detail !== 0 && start?.anchor === link.anchor && start.href === link.href
    const assistive = !start && event.detail === 0 && link.anchor === document.activeElement

    if (paired || assistive) review(link.href)
  }

  makeEventListener(document, "click", click, true)
  makeEventListener(document, "auxclick", click, true)
}
