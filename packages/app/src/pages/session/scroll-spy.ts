type Visible = {
  id: string
  ratio: number
  top: number
}

type Offset = {
  id: string
  top: number
}

type Input = {
  onActive: (id: string) => void
  raf?: (cb: FrameRequestCallback) => number
  caf?: (id: number) => void
  IntersectionObserver?: typeof globalThis.IntersectionObserver
  ResizeObserver?: typeof globalThis.ResizeObserver
  MutationObserver?: typeof globalThis.MutationObserver
}

export const pickVisibleId = (list: Visible[], line: number) => {
  if (list.length === 0) return

  const sorted = [...list].sort((a, b) => {
    if (b.ratio !== a.ratio) return b.ratio - a.ratio

    const da = Math.abs(a.top - line)
    const db = Math.abs(b.top - line)
    if (da !== db) return da - db

    return a.top - b.top
  })

  return sorted[0]?.id
}

export const pickOffsetId = (list: Offset[], cutoff: number) => {
  if (list.length === 0) return

  let lo = 0
  let hi = list.length - 1
  let out = 0

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const top = list[mid]?.top
    if (top === undefined) break

    if (top <= cutoff) {
      out = mid
      lo = mid + 1
      continue
    }

    hi = mid - 1
  }

  return list[out]?.id
}

export const createScrollSpy = (input: Input) => {
  const raf = input.raf ?? requestAnimationFrame
  const caf = input.caf ?? cancelAnimationFrame
  const CtorIO = input.IntersectionObserver ?? globalThis.IntersectionObserver
  const CtorRO = input.ResizeObserver ?? globalThis.ResizeObserver
  const CtorMO = input.MutationObserver ?? globalThis.MutationObserver

  let root: HTMLDivElement | undefined
  let io: IntersectionObserver | undefined
  let ro: ResizeObserver | undefined
  let mo: MutationObserver | undefined
  let frame: number | undefined
  let active: string | undefined
  let dirty = true

  const node = new Map<string, HTMLElement>()
  const id = new WeakMap<HTMLElement, string>()
  const visible = new Map<string, { ratio: number; top: number }>()
  let offset: Offset[] = []

  const schedule = () => {
    if (frame !== undefined) return
    frame = raf(() => {
      frame = undefined
      update()
    })
  }

  const refreshOffset = () => {
    const el = root
    if (!el) {
      offset = []
      dirty = false
      return
    }

    const base = el.getBoundingClientRect().top
    offset = [...node].map(([next, item]) => ({
      id: next,
      top: item.getBoundingClientRect().top - base + el.scrollTop,
    }))
    offset.sort((a, b) => a.top - b.top)
    dirty = false
  }

  const update = () => {
    const el = root
    if (!el) return

    const line = el.getBoundingClientRect().top + 100
    const next =
      pickVisibleId(
        [...visible].map(([k, v]) => ({
          id: k,
          ratio: v.ratio,
          top: v.top,
        })),
        line,
      ) ??
      (() => {
        if (dirty) refreshOffset()
        return pickOffsetId(offset, el.scrollTop + 100)
      })()

    if (!next || next === active) return
    active = next
    input.onActive(next)
  }

  const observe = () => {
    const el = root
    if (!el) return

    io?.disconnect()
    io = undefined
    if (CtorIO) {
      try {
        io = new CtorIO(
          (entries) => {
            for (const entry of entries) {
              const item = entry.target
              if (!(item instanceof HTMLElement)) continue
              const key = id.get(item)
              if (!key) continue

              if (!entry.isIntersecting || entry.intersectionRatio <= 0) {
                visible.delete(key)
                continue
              }

              visible.set(key, {
                ratio: entry.intersectionRatio,
                top: entry.boundingClientRect.top,
              })
            }

            schedule()
          },
          {
            root: el,
            threshold: [0, 0.25, 0.5, 0.75, 1],
          },
        )
      } catch {
        io = undefined
      }
    }

    if (io) {
      for (const item of node.values()) io.observe(item)
    }

    ro?.disconnect()
    ro = undefined
    if (CtorRO) {
      ro = new CtorRO(() => {
        dirty = true
        schedule()
      })
      ro.observe(el)
      for (const item of node.values()) ro.observe(item)
    }

    mo?.disconnect()
    mo = undefined
    if (CtorMO) {
      mo = new CtorMO(() => {
        dirty = true
        schedule()
      })
      mo.observe(el, { subtree: true, childList: true, characterData: true })
    }

    dirty = true
    schedule()
  }

  const setContainer = (el?: HTMLDivElement) => {
    if (root === el) return

    root = el
    visible.clear()
    active = undefined
    observe()
  }

  const register = (el: HTMLElement, key: string) => {
    const prev = node.get(key)
    if (prev && prev !== el) {
      io?.unobserve(prev)
      ro?.unobserve(prev)
    }

    node.set(key, el)
    id.set(el, key)
    if (io) io.observe(el)
    if (ro) ro.observe(el)
    dirty = true
    schedule()
  }

  const unregister = (key: string) => {
    const item = node.get(key)
    if (!item) return

    io?.unobserve(item)
    ro?.unobserve(item)
    node.delete(key)
    visible.delete(key)
    dirty = true
    schedule()
  }

  const markDirty = () => {
    dirty = true
    schedule()
  }

  const clear = () => {
    for (const item of node.values()) {
      io?.unobserve(item)
      ro?.unobserve(item)
    }

    node.clear()
    visible.clear()
    offset = []
    active = undefined
    dirty = true
  }

  const destroy = () => {
    if (frame !== undefined) caf(frame)
    frame = undefined
    clear()
    io?.disconnect()
    ro?.disconnect()
    mo?.disconnect()
    io = undefined
    ro = undefined
    mo = undefined
    root = undefined
  }

  return {
    setContainer,
    register,
    unregister,
    onScroll: schedule,
    markDirty,
    clear,
    destroy,
    getActiveId: () => active,
  }
}
