export function accordionValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value
  if (value) return [value]
  return []
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
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    obs?.disconnect()
    clearTimeout(timer)
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

  const obs =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => {
          still = 0
          if (frame === undefined) step()
        })

  obs?.observe(pane)
  obs?.observe(head)

  const timer = setTimeout(stop, 400)
  step()
}
