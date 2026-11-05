import { JSX, Show, createEffect, createUniqueId, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { IconChevron } from "./icon"
import "./dropdown.css"

interface DropdownProps {
  trigger: JSX.Element | string
  /** What the trigger chooses, read by screen readers before a string trigger, for example "Language". */
  label?: string
  children: JSX.Element
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: "left" | "right"
  class?: string
}

export function Dropdown(props: DropdownProps) {
  const [store, setStore] = createStore({
    isOpen: props.open ?? false,
  })
  let dropdownRef: HTMLDivElement | undefined
  const id = createUniqueId()

  createEffect(() => {
    if (props.open !== undefined) {
      setStore("isOpen", props.open)
    }
  })

  createEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
        setStore("isOpen", false)
        props.onOpenChange?.(false)
      }
    }

    document.addEventListener("click", handleClickOutside)
    onCleanup(() => document.removeEventListener("click", handleClickOutside))
  })

  createEffect(() => {
    if (!store.isOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (dropdownRef?.contains(document.activeElement))
        dropdownRef.querySelector<HTMLElement>("[data-slot=trigger]")?.focus()
      setStore("isOpen", false)
      props.onOpenChange?.(false)
    }
    document.addEventListener("keydown", handleEscape)
    onCleanup(() => document.removeEventListener("keydown", handleEscape))
  })

  const toggle = () => {
    const newValue = !store.isOpen
    setStore("isOpen", newValue)
    props.onOpenChange?.(newValue)
  }

  return (
    <div data-component="dropdown" class={props.class} ref={dropdownRef}>
      <button
        data-slot="trigger"
        type="button"
        aria-expanded={store.isOpen}
        aria-controls={id}
        aria-label={props.label && typeof props.trigger === "string" ? `${props.label}: ${props.trigger}` : undefined}
        onClick={toggle}
      >
        {typeof props.trigger === "string" ? <span>{props.trigger}</span> : props.trigger}
        <IconChevron data-slot="chevron" aria-hidden="true" />
      </button>

      <Show when={store.isOpen}>
        <div data-slot="dropdown" id={id} data-align={props.align ?? "left"}>
          {props.children}
        </div>
      </Show>
    </div>
  )
}

interface DropdownItemProps {
  children: JSX.Element
  selected?: boolean
  onClick?: () => void
  type?: "button" | "submit" | "reset"
}

export function DropdownItem(props: DropdownItemProps) {
  return (
    <button
      data-slot="item"
      data-selected={props.selected ?? false}
      aria-current={props.selected ? "true" : undefined}
      type={props.type ?? "button"}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
