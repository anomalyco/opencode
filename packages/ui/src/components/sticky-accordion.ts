export function accordionValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value
  if (value) return [value]
  return []
}

function pick(list: (HTMLElement | undefined)[]) {
  return list.reduce<HTMLElement | undefined>((best, el) => {
    if (!el) return best
    if (!best) return el
    return el.getBoundingClientRect().top < best.getBoundingClientRect().top ? el : best
  }, undefined)
}

function root(el: HTMLElement) {
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) {
      return node
    }
    node = node.parentElement
  }
}

export function pinSticky(head: HTMLElement | undefined, fn: () => void) {
  const pane = head ? root(head) : undefined
  const top = head?.getBoundingClientRect().top

  fn()

  if (!pane || !head || top === undefined) return

  let frame: number | undefined
  let still = 0
  let obs: ResizeObserver | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    obs?.disconnect()
    if (timer !== undefined) clearTimeout(timer)
  }

  const step = () => {
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (!head.isConnected) {
        stop()
        return
      }

      const delta = top - head.getBoundingClientRect().top
      if (Math.abs(delta) >= 1) {
        pane.scrollTop -= delta
        still = 0
      } else {
        still += 1
      }

      if (still >= 2) {
        stop()
        return
      }

      step()
    })
  }

  obs =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => {
          still = 0
          if (frame === undefined) step()
        })

  obs?.observe(pane)
  obs?.observe(head)

  timer = setTimeout(stop, 400)
  step()
}

export function pinStickyAccordionChange(
  prev: string[],
  value: string | string[] | undefined,
  get: (key: string) => HTMLElement | undefined,
  update: (next: string[]) => void,
) {
  const next = accordionValue(value)
  const head = pick(prev.filter((item) => !next.includes(item)).map(get))
  if (!head) {
    update(next)
    return
  }
  pinSticky(head, () => update(next))
}
