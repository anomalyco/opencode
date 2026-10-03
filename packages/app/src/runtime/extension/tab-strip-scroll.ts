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

export const createTabStripScroll = (input: { el: HTMLDivElement; lead: () => boolean }) => {
  let frame: number | undefined
  let prevScrollWidth = input.el.scrollWidth
  let prevLeadOpen = input.lead()

  const update = () => {
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
  const observer = new MutationObserver(schedule)
  observer.observe(input.el, { childList: true })

  return () => {
    input.el.removeEventListener("wheel", onWheel)
    observer.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}
