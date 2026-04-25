import h from "solid-js/h"
import { createEffect, onCleanup, type Component, type JSXElement } from "solid-js"
import { Portal } from "solid-js/web"
import type { MessageContextItem } from "@/context/prompt"
import { uuid } from "@/utils/uuid"
import type { MessageSelection } from "./message-selection"

const gap = 12
const limit = 96

const clear = () => window.getSelection()?.removeAllRanges()

const preview = (quote: string) => {
  const text = quote.replace(/\s+/g, " ").trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}

const rangeRect = () => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  return sel.getRangeAt(0).getBoundingClientRect()
}

const size = (el?: HTMLTextAreaElement) => {
  if (!el) return
  el.style.height = "0px"
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

export const MessageAnnotationPopover: Component<{
  selection?: MessageSelection
  add: (item: MessageContextItem) => void
  onClose: () => void
  placeholderLabel: string
  saveLabel: string
  cancelLabel: string
  portal?: boolean
}> = (props) => {
  let item: MessageSelection | undefined
  let top = 0
  let left = 0
  let ready = false
  let id: number | undefined
  let live = false
  const root = () => document.querySelector('[data-slot="message-annotation-root"]') as HTMLDivElement | null
  const head = () => document.querySelector('[data-slot="message-annotation-head"]') as HTMLDivElement | null
  const input = () => document.querySelector('[data-slot="message-annotation-input"]') as HTMLTextAreaElement | null
  const save = () => document.querySelector('[data-slot="message-annotation-save"]') as HTMLButtonElement | null
  const cancel = () => document.querySelector('[data-slot="message-annotation-cancel"]') as HTMLButtonElement | null

  const sync = () => {
    const box = root()
    if (box) {
      if (item) {
        box.dataset.component = "message-annotation-popover"
        box.style.display = ""
      } else {
        box.removeAttribute("data-component")
        box.style.display = "none"
      }

      box.style.top = `${top}px`
      box.style.left = `${left}px`
      box.style.opacity = ready ? "1" : "0"
      box.style.pointerEvents = ready ? "auto" : "none"
      box.style.transform = `translate(-50%, ${ready ? "0px" : "4px"})`
    }

    const title = head()
    if (title) {
      title.textContent = item ? preview(item.quote) : ""
    }

    const field = input()
    if (field) {
      if (item) field.dataset.component = "message-annotation-input"
      else field.removeAttribute("data-component")
    }

    const submit = save()
    if (submit) {
      if (item) submit.dataset.action = "message-annotation-save"
      else submit.removeAttribute("data-action")
      submit.disabled = !item || (field?.value.trim().length ?? 0) === 0
    }

    const dismiss = cancel()
    if (dismiss) {
      if (item) dismiss.dataset.action = "message-annotation-cancel"
      else dismiss.removeAttribute("data-action")
    }
  }

  const bind = () => {
    if (live) return
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

  const reset = () => {
    const field = input()
    if (!field) return
    field.value = ""
    size(field)
  }

  const hide = () => {
    item = undefined
    ready = false
    if (id !== undefined) {
      window.clearTimeout(id)
      id = undefined
    }
    reset()
    sync()
    drop()
  }

  const close = () => {
    if (!item) return
    clear()
    hide()
    props.onClose()
  }

  const place = (selection: MessageSelection) => {
    const box = rangeRect() ?? selection.rect
    const pop = root()
    if (!pop) return

    const rect = pop.getBoundingClientRect()
    const half = rect.width / 2
    const center = box.left + box.width / 2
    left = Math.min(Math.max(center, gap + half), window.innerWidth - gap - half)
    top =
      box.top >= rect.height + gap
        ? Math.max(gap, box.top - rect.height - gap)
        : Math.max(gap, Math.min(window.innerHeight - rect.height - gap, box.bottom + gap))
    sync()
  }

  const focus = () => {
    const field = input()
    size(field ?? undefined)
    field?.focus()
    const end = field?.value.length ?? 0
    field?.setSelectionRange(end, end)
  }

  const submit = () => {
    if (!item) return

    const comment = input()?.value.trim()
    if (!comment) return

    props.add({
      type: "message",
      annotationID: uuid(),
      messageID: item.messageID,
      role: item.role,
      quote: item.quote,
      preview: preview(item.quote),
      comment,
    })
    close()
  }

  const down = (event: PointerEvent) => {
    const target = event.target
    if (target instanceof Node && root()?.contains(target)) return
    close()
  }

  const collapse = () => {
    if (!ready) return
    if (document.activeElement instanceof Node && root()?.contains(document.activeElement)) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) return
    close()
  }

  const queue = () => {
    if (id !== undefined) window.clearTimeout(id)
    id = window.setTimeout(() => {
      id = undefined
      if (!item) {
        hide()
        return
      }

      place(item)
      focus()
      ready = true
      sync()
      bind()
    }, 0)
  }

  createEffect(() => {
    item = props.selection
    if (!item) {
      hide()
      return
    }

    ready = false
    reset()
    sync()
    queue()
  })

  onCleanup(() => {
    if (id !== undefined) window.clearTimeout(id)
    drop()
  })

  const body: JSXElement = h(
    "div",
    {
      "data-slot": "message-annotation-root",
      role: "dialog",
      "aria-modal": "false",
      "data-message-selection-ignore": "true",
      class:
        "fixed z-[70] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-[12px] border border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)] transition-[opacity,transform] duration-150 ease-out",
      style: {
        display: "none",
        opacity: "0",
        left: "0px",
        top: "0px",
        transform: "translate(-50%, 4px)",
        "pointer-events": "none",
      },
    },
    h("div", {
      "data-slot": "message-annotation-head",
      class: "border-b border-border-weaker-base px-3 py-2 text-11-medium text-text-weak truncate",
    }),
    h(
      "div",
      { class: "flex flex-col gap-2 p-2" },
      h("textarea", {
        "data-slot": "message-annotation-input",
        rows: 3,
        placeholder: props.placeholderLabel,
        class:
          "min-h-16 max-h-40 w-full resize-y rounded-md border border-border-base bg-background-base px-2 py-2 text-13-regular text-text-strong outline-none placeholder:text-text-weaker focus:shadow-[var(--shadow-xs-border-select)]",
        onInput: (event: Event & { currentTarget: HTMLTextAreaElement }) => {
          size(event.currentTarget)
          sync()
        },
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.preventDefault()
            close()
            return
          }

          if (event.key !== "Enter" || event.shiftKey) return
          event.preventDefault()
          submit()
        },
      }),
      h(
        "div",
        { class: "flex items-center justify-end gap-2 pl-2" },
        h(
          "button",
          {
            "data-slot": "message-annotation-cancel",
            type: "button",
            "data-variant": "ghost",
            class:
              "h-7 rounded-md border border-border-base bg-transparent px-2.5 text-12-medium text-text-strong transition-colors hover:bg-surface-raised-base-hover",
            onClick: close,
          },
          props.cancelLabel,
        ),
        h(
          "button",
          {
            "data-slot": "message-annotation-save",
            type: "button",
            "data-variant": "primary",
            disabled: true,
            class:
              "h-7 rounded-md border border-text-strong bg-text-strong px-2.5 text-12-medium text-background-base transition-opacity disabled:pointer-events-none disabled:opacity-50",
            onClick: submit,
          },
          props.saveLabel,
        ),
      ),
    ),
  ) as unknown as JSXElement

  return (props.portal === false ? body : h(Portal, null, body)) as unknown as JSXElement
}
