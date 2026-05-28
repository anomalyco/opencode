import { raf } from "./frame"

type Widget = HTMLElement & {
  requestUpdate?: () => unknown
  updateComplete?: Promise<unknown>
}
type End = {
  dispose?: () => void
}
type Slot = {
  on?: (fn: () => void) => End
}
type YDoc = {
  on?: (name: "update", fn: () => void) => void
  off?: (name: "update", fn: () => void) => void
}
type Editor = HTMLElement & {
  host?: {
    selection?: {
      slots?: {
        remoteChanged?: Slot
      }
    }
  }
  std?: {
    doc?: {
      spaceDoc?: YDoc
    }
    selection?: {
      slots?: {
        remoteChanged?: Slot
      }
    }
  }
}

function widgets(editor: HTMLElement) {
  return Array.from(editor.querySelectorAll<HTMLElement>("affine-doc-remote-selection-widget")).filter(
    (node): node is Widget => node instanceof HTMLElement,
  )
}

function cursorLabels(editor: HTMLElement) {
  return widgets(editor).flatMap((widget) => {
    const root = widget.shadowRoot
    if (!root) return []
    return Array.from(root.querySelectorAll("div"))
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        const style = getComputedStyle(el)
        return style.whiteSpace === "nowrap" && style.textOverflow === "ellipsis"
      })
  })
}

function flipCursorLabels(editor: HTMLElement) {
  const edge = editor.getBoundingClientRect().right - 8
  cursorLabels(editor).forEach((label) => {
    label.style.transform = ""
    label.style.transformOrigin = ""
    label.style.maxWidth = "160px"
    const rect = label.getBoundingClientRect()
    const right = rect.left + Math.min(label.scrollWidth, 160)
    const overflow = Math.max(rect.right, right) - edge
    if (overflow <= 0) return
    label.style.transform = `translateX(-${Math.ceil(Math.max(rect.width - 8, overflow))}px)`
    label.style.transformOrigin = "right bottom"
    const left = label.getBoundingClientRect().left
    if (left >= 8) return
    label.style.maxWidth = `${Math.max(48, edge - 8)}px`
  })
}

function pulse(fn: () => void) {
  let id = 0
  let left = 0
  const step = () => {
    id = 0
    if (left <= 0) return
    left--
    fn()
    if (left > 0) id = requestAnimationFrame(step)
  }
  return {
    run: (count = 6) => {
      left = Math.max(left, count)
      if (id) return
      id = requestAnimationFrame(step)
    },
    stop: () => {
      left = 0
      if (!id) return
      cancelAnimationFrame(id)
      id = 0
    },
  }
}

export function watchCursorLabels(editor: HTMLElement, host: HTMLElement) {
  const page = editor as Editor
  const seen = new WeakSet<ShadowRoot>()
  const task = raf(() => flipCursorLabels(editor))
  const refresh = pulse(() => {
    widgets(editor).forEach((widget) => {
      widget.requestUpdate?.()
      void widget.updateComplete?.then(() => task.run())
    })
    task.run()
  })
  const obs = new MutationObserver((records) => {
    const stale = records.some((record) => {
      if (record.type === "childList") return true
      if (!(record.target instanceof HTMLElement)) return false
      return getComputedStyle(record.target).display === "none"
    })
    if (stale) {
      refresh.run(2)
      return
    }
    task.run()
  })
  const bind = () => {
    widgets(editor).forEach((widget) => {
      if (!widget.shadowRoot) return
      if (seen.has(widget.shadowRoot)) return
      seen.add(widget.shadowRoot)
      obs.observe(widget.shadowRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      })
    })
    refresh.run()
  }
  const roots = new MutationObserver(bind)
  roots.observe(editor, { childList: true, characterData: true, subtree: true })
  const update = () => refresh.run(2)
  const viewport = editor.querySelector(".affine-page-viewport")
  host.addEventListener("scroll", update, true)
  viewport?.addEventListener("scroll", update, true)
  window.addEventListener("resize", update)
  const remote = page.std?.selection?.slots?.remoteChanged ?? page.host?.selection?.slots?.remoteChanged
  const off = remote?.on?.(() => refresh.run())
  const sync = page.std?.doc?.spaceDoc
  const next = () => refresh.run()
  sync?.on?.("update", next)
  bind()
  return () => {
    refresh.stop()
    task.stop()
    obs.disconnect()
    roots.disconnect()
    off?.dispose?.()
    sync?.off?.("update", next)
    host.removeEventListener("scroll", update, true)
    viewport?.removeEventListener("scroll", update, true)
    window.removeEventListener("resize", update)
  }
}
