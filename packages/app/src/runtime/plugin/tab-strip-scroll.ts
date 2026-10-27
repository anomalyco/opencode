type Input = {
  prevScrollWidth: number
  scrollWidth: number
  clientWidth: number
  prevLeadOpen: boolean
  leadOpen: boolean
}

/** A tab that opens at the lead of the strip scrolls to the start; other new tabs scroll to the end. */
export const nextTabStripScrollLeft = (input: Input) => {
  if (input.scrollWidth <= input.prevScrollWidth) return

  if (!input.prevLeadOpen && input.leadOpen) return 0

  if (input.scrollWidth <= input.clientWidth) return

  return input.scrollWidth - input.clientWidth
}

const EDGE_FADE = 24

export const createTabStripScroll = (input: { el: HTMLDivElement; lead: () => boolean }) => {
  let frame: number | undefined
  let prevScrollWidth = input.el.scrollWidth
  let prevLeadOpen = input.lead()
  const written: Record<string, string> = {}

  // Each edge fades by as much as the strip has scrolled past it, up to EDGE_FADE, so the masks grow in with the
  // scroll instead of popping. The end fade stops at the sticky "+", the strip's last child, which stays unmasked.
  // RTL strips scroll to negative offsets.
  const fade = () => {
    const offset = Math.abs(input.el.scrollLeft)
    const add = input.el.lastElementChild instanceof HTMLElement ? input.el.lastElementChild.offsetWidth : 0
    const rest = input.el.scrollWidth - input.el.clientWidth - offset

    write("--tab-strip-fade-start", Math.min(offset, EDGE_FADE))
    write("--tab-strip-fade-end", Math.min(Math.max(rest, 0), EDGE_FADE))
    write("--tab-strip-add", add)
  }

  // Only changed values are written, so scrolling well inside the strip restyles nothing.
  const write = (name: string, px: number) => {
    const value = `${Math.round(px)}px`

    if (written[name] === value) return
    written[name] = value
    input.el.style.setProperty(name, value)
  }

  const update = () => {
    fade()

    const scrollWidth = input.el.scrollWidth
    const clientWidth = input.el.clientWidth
    const leadOpen = input.lead()

    const left = nextTabStripScrollLeft({
      prevScrollWidth,
      scrollWidth,
      clientWidth,
      prevLeadOpen,
      leadOpen,
    })

    if (left !== undefined) {
      input.el.scrollTo({
        left,
        behavior: "smooth",
      })
    }

    prevScrollWidth = scrollWidth
    prevLeadOpen = leadOpen
  }

  const schedule = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      update()
    })
  }

  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    input.el.scrollLeft += e.deltaY > 0 ? 50 : -50
    e.preventDefault()
  }

  input.el.addEventListener("wheel", onWheel, { passive: false })
  input.el.addEventListener("scroll", fade, { passive: true })
  // The strip and each tab, so a resized strip or a retitled tab updates the fades; opening and closing tabs updates
  // them through `update`.
  const resize = new ResizeObserver(fade)

  resize.observe(input.el)
  Array.from(input.el.children).forEach((child) => resize.observe(child))

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => node instanceof Element && resize.observe(node))
      record.removedNodes.forEach((node) => node instanceof Element && resize.unobserve(node))
    })

    schedule()
  })

  observer.observe(input.el, { childList: true })

  return () => {
    input.el.removeEventListener("wheel", onWheel)
    input.el.removeEventListener("scroll", fade)
    observer.disconnect()
    resize.disconnect()

    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}
