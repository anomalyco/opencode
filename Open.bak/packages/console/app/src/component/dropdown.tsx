import { JSX, Show, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { IconChevron } from "./icon"
import "./dropdown.css"

interface DropdownProps {
  trigger: JSX.Element | string
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

  const toggle = () => {
    const newValue = !store.isOpen
    setStore("isOpen", newValue)
    props.onOpenChange?.(newValue)
  }

  return (
    <div data-component="dropdown" class={props.class} ref={dropdownRef}>
      <button data-slot="trigger" type="button" onClick={toggle}>
        {typeof props.trigger === "string" ? <span>{props.trigger}</span> : props.trigger}
        <IconChevron data-slot="chevron" />
      </button>

      <Show when={store.isOpen}>
        <div data-slot="dropdown" data-align={props.align ?? "left"}>
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
      type={props.type ?? "button"}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
