import { createEffect, createMemo, createUniqueId } from "solid-js"
import { createStore } from "solid-js/store"

/** The active row, keys and combobox ids for a search input above a list of options. */
export function createTypeahead<T>(props: {
  items: () => T[]
  key: (item: T) => string
  /** Rows on screen that the current query has not confirmed. The user's choice never rests on one. */
  stale?: (item: T) => boolean
  onSelect: (item: T) => void
  onClose?: () => void
}) {
  const id = createUniqueId()
  const [store, setStore] = createStore<{ active?: string }>({})
  const chosen = () => props.items().find((item) => props.key(item) === store.active && !props.stale?.(item))

  // The user's choice holds while it is among the confirmed rows; once it leaves, the first row is active again.
  createEffect(() => {
    if (store.active !== undefined && chosen() === undefined) setStore("active", undefined)
  })

  const activeItem = createMemo(() => chosen() ?? props.items()[0])
  const optionID = (item: T) => `${id}-${encodeURIComponent(props.key(item))}`

  return {
    activeItem,
    setActive: (key: string | undefined) => setStore("active", key),
    listID: `${id}-list`,
    optionID,
    activeID: () => {
      const item = activeItem()

      return item === undefined ? undefined : optionID(item)
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.isComposing) return
      const items = props.items()
      const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0

      if (delta !== 0 || event.key === "Enter" || (event.key === "Escape" && props.onClose)) {
        event.preventDefault()
        event.stopPropagation()
      }

      if (delta !== 0 && items.length > 0) {
        const index = items.findIndex((item) => item === activeItem())
        setStore("active", props.key(items[(index + delta + items.length) % items.length]))
      }

      const item = activeItem()

      if (event.key === "Enter" && item !== undefined) props.onSelect(item)

      if (event.key === "Escape") props.onClose?.()
    },
  }
}
