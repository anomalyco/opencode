import h from "solid-js/h"
import { createEffect, onCleanup, type Component, type JSXElement } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import type { MessageSelection } from "./message-selection"

const gap = 12
const offset = 8
const limit = 96
const max = 240
const size = 28
const half = size / 2

type State = "hidden" | "visible"

export type MessageAnnotationTriggerVariant = "icon" | "toolbar" | "mini"

const pick = (selection: MessageSelection) => selection.anchor ?? selection.rect
const kind = (variant?: MessageAnnotationTriggerVariant) => variant ?? "icon"
const wide = (variant: MessageAnnotationTriggerVariant) => variant !== "icon"
const preview = (quote: string) => {
  const text = quote.replace(/\s+/g, " ").trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}
const shift = (variant: MessageAnnotationTriggerVariant) =>
  variant === "icon" ? "translate(0, -50%)" : "translate(calc(28px - 100%), -50%)"
const shell = (variant: MessageAnnotationTriggerVariant) => {
  const base =
    "fixed z-[70] flex h-7 items-center rounded-full border border-border-weak-base bg-surface-raised-stronger-non-alpha shadow-[var(--shadow-lg-border-base)]"
  if (variant === "icon") return `${base} w-7 justify-center text-13-medium text-text-strong`
  return `${base} min-w-0 max-w-[min(320px,calc(100vw-24px))] gap-1 pl-2 pr-1 text-text-strong`
}
const span = (value: string) => Math.min(max, value.length * 6)

export const MessageAnnotationTrigger: Component<{
  selection?: MessageSelection
  variant?: MessageAnnotationTriggerVariant
  label: string
  onOpen: (selection: MessageSelection) => void
  onClose: () => void
}> = (props) => {
  let el: HTMLButtonElement | undefined
  let lab: HTMLSpanElement | undefined
  let text: HTMLSpanElement | undefined
  let item: MessageSelection | undefined
  let state: State = "hidden"
  let live = false
  let left = 0
  let top = 0

  const copy = (variant: MessageAnnotationTriggerVariant) => {
    if (variant === "toolbar") return props.label
    if (variant === "mini" && item) return preview(item.quote)
    return ""
  }

  const paint = (variant: MessageAnnotationTriggerVariant) => {
    const value = copy(variant)

    if (lab) {
      lab.style.display = variant === "toolbar" ? "block" : "none"
      lab.textContent = variant === "toolbar" ? value : ""
    }

    if (text) {
      text.style.display = variant === "mini" ? "block" : "none"
      text.textContent = variant === "mini" ? value : ""
      if (variant === "mini" && value) text.title = value
      else text.removeAttribute("title")
    }
  }

  const width = (variant: MessageAnnotationTriggerVariant) => {
    if (!wide(variant)) return size
    if (!el) return Math.min(window.innerWidth - gap * 2, size + 12 + span(copy(variant)))

    const left = el.style.left
    const top = el.style.top
    const display = el.style.display
    const pointer = el.style.pointerEvents
    const visibility = el.style.visibility
    const transform = el.style.transform
    const cls = el.className

    el.className = shell(variant)
    el.style.left = "0px"
    el.style.top = "0px"
    el.style.display = ""
    el.style.pointerEvents = "none"
    el.style.visibility = "hidden"
    el.style.transform = shift(variant)
    paint(variant)

    const value = el.getBoundingClientRect().width || el.scrollWidth || size + 12 + span(copy(variant))

    el.className = cls
    el.style.left = left
    el.style.top = top
    el.style.display = display
    el.style.pointerEvents = pointer
    el.style.visibility = visibility
    el.style.transform = transform

    return Math.min(Math.max(value, size), window.innerWidth - gap * 2)
  }

  const sync = () => {
    if (!el) return

    const mode = kind(props.variant)

    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.transform = shift(mode)
    el.className = shell(mode)
    el.setAttribute("aria-label", props.label)
    paint(mode)

    if (state === "visible") {
      el.dataset.component = "message-annotation-trigger"
      el.dataset.action = "message-annotation-trigger-open"
      el.dataset.variant = mode
      el.style.display = ""
      el.style.pointerEvents = "auto"
      return
    }

    el.removeAttribute("data-component")
    el.removeAttribute("data-action")
    el.removeAttribute("data-variant")
    if (lab) lab.textContent = ""
    if (text) {
      text.textContent = ""
      text.removeAttribute("title")
    }
    el.style.display = "none"
    el.style.pointerEvents = "none"
  }

  const down = (event: PointerEvent) => {
    const target = event.target
    if (target instanceof Node && el?.contains(target)) return
    close()
  }

  const collapse = () => {
    if (state !== "visible") return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) return
    close()
  }

  const bind = () => {
    if (live || state !== "visible") return
    live = true
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("selectionchange", collapse)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
  }

  const drop = () => {
    if (!live) return
    live = false
    document.removeEventListener("pointerdown", down, true)
    document.removeEventListener("selectionchange", collapse)
    window.removeEventListener("scroll", close, true)
    window.removeEventListener("resize", close)
  }

  const hide = () => {
    state = "hidden"
    sync()
    drop()
  }

  const close = () => {
    if (state !== "visible") return
    hide()
    props.onClose()
  }

  const place = (selection: MessageSelection) => {
    const mode = kind(props.variant)
    const box = pick(selection)
    const next = width(mode)
    const x = Math.max(gap + next - size, window.innerWidth - gap - size)
    const y = Math.max(gap + half, window.innerHeight - gap - half)
    left = Math.min(Math.max(box.right + offset, gap + next - size), x)
    top = Math.min(Math.max(box.top + box.height / 2, gap + half), y)
    sync()
  }

  const open = () => {
    if (!item) return
    props.onOpen(item)
  }

  createEffect(() => {
    item = props.selection
    if (!item) {
      hide()
      return
    }

    state = "visible"
    place(item)
    bind()
  })

  onCleanup(drop)

  return h(
    "button",
    {
      ref: (node: HTMLButtonElement) => {
        el = node
        sync()
      },
      type: "button",
      "aria-label": props.label,
      "data-message-selection-ignore": "true",
      class:
        shell(kind(props.variant)),
      style: {
        display: "none",
        left: "0px",
        top: "0px",
        transform: shift(kind(props.variant)),
        "pointer-events": "none",
      },
      onPointerDown: (event: PointerEvent) => {
        event.preventDefault()
        event.stopPropagation()
      },
      onMouseDown: (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
      },
      onClick: (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        open()
      },
    },
    h(
      "span",
      {
        class: "flex min-w-0 items-center gap-1",
      },
      h("span", {
        ref: (node: HTMLSpanElement) => {
          text = node
        },
        "data-slot": "message-annotation-trigger-quote",
        class: "min-w-0 max-w-[240px] truncate text-11-medium text-text-weak",
        style: {
          display: "none",
        },
      }),
      h("span", {
        ref: (node: HTMLSpanElement) => {
          lab = node
        },
        "data-slot": "message-annotation-trigger-label",
        class: "min-w-0 max-w-[240px] truncate whitespace-nowrap text-12-medium",
        style: {
          display: "none",
        },
      }),
      h(Icon, {
        name: "bubble-5",
        size: "small",
        class: "shrink-0",
      }),
    ),
  ) as unknown as JSXElement
}
