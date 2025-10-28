import { ComponentProps, createEffect, createSignal, type JSX } from "solid-js"
import { VirtualizerHandle, VList } from "virtua/solid"
import { createList } from "solid-list"
import { createStore } from "solid-js/store"

export interface ListProps<T> {
  data: T[]
  children: (x: T) => JSX.Element
  key: (x: T) => string
  current?: T
  onSelect?: (value: T | undefined) => void
  onHover?: (value: T | undefined) => void
  class?: ComponentProps<"div">["class"]
}

export function List<T>(props: ListProps<T>) {
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle | undefined>(undefined)
  const [store, setStore] = createStore({
    mouseActive: false,
  })
  const list = createList({
    items: () => props.data.map(props.key),
    initialActive: props.current ? props.key(props.current) : undefined,
    loop: true,
  })

  createEffect(() => {
    if (props.current) list.setActive(props.key(props.current))
  })
  // const resetSelection = () => {
  //   if (props.data.length === 0) return
  //   list.setActive(props.key(props.data[0]))
  // }
  const handleSelect = (item: T) => {
    props.onSelect?.(item)
    list.setActive(props.key(item))
  }

  const handleKey = (e: KeyboardEvent) => {
    setStore("mouseActive", false)

    if (e.key === "Enter") {
      e.preventDefault()
      const selected = props.data.find((x) => props.key(x) === list.active())
      if (selected) handleSelect(selected)
    } else {
      list.onKeyDown(e)
    }
  }

  createEffect(() => {
    if (store.mouseActive || props.data.length === 0) return
    const index = props.data.findIndex((x) => props.key(x) === list.active())
    props.onHover?.(props.data[index])
    if (index === 0) {
      virtualizer()?.scrollTo(0)
      return
    }
    // virtualizer()?.scrollTo(list.active())
    // const element = virtualizer()?.querySelector(`[data-key="${list.active()}"]`)
    // element?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  })

  return (
    <VList data-component="list" ref={setVirtualizer} data={props.data} onKeyDown={handleKey} class={props.class}>
      {(item) => (
        <button
          data-slot="item"
          data-key={props.key(item)}
          data-active={props.key(item) === list.active()}
          onClick={() => handleSelect(item)}
          onMouseMove={() => {
            // e.currentTarget.focus()
            setStore("mouseActive", true)
            // list.setActive(props.key(item))
          }}
        >
          {props.children(item)}
        </button>
      )}
    </VList>
  )
}
