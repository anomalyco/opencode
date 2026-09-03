import { createContext, onCleanup, onMount, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"

export function createTitlebarNavigationSlot(collapsed: () => boolean) {
  const [store, setStore] = createStore<{ start: HTMLElement[]; end: HTMLElement[] }>({ start: [], end: [] })
  return {
    collapsed,
    mount: (side: "start" | "end") => store[side].at(-1),
    register(side: "start" | "end", element: HTMLElement) {
      setStore(side, (items) => [...items, element])
      onCleanup(() => setStore(side, (items) => items.filter((item) => item !== element)))
    },
  }
}

const TitlebarNavigationContext = createContext<ReturnType<typeof createTitlebarNavigationSlot>>()
export function TitlebarNavigationProvider(
  props: ParentProps<{ value: ReturnType<typeof createTitlebarNavigationSlot> }>,
) {
  return <TitlebarNavigationContext.Provider value={props.value}>{props.children}</TitlebarNavigationContext.Provider>
}

export function useTitlebarNavigationSlot() {
  return useContext(TitlebarNavigationContext)
}

export function TitlebarNavigationHeader() {
  const slot = useTitlebarNavigationSlot()
  if (!slot) return null
  return (
    <div
      data-slot="panel-navigation-header"
      class="flex shrink-0 items-center justify-between ps-2.5"
      style={{
        display: slot.collapsed() ? undefined : "none",
        "padding-inline-end": "calc((var(--shell-header-height, 48px) - 28px) / 2 + var(--tabs-trailing-inset, 0px))",
      }}
    >
      <TitlebarNavigationMount side="start" />
      <TitlebarNavigationMount side="end" />
    </div>
  )
}

export function TitlebarNavigationMount(props: { side: "start" | "end" }) {
  const slot = useContext(TitlebarNavigationContext)
  if (!slot) return null
  let mount!: HTMLDivElement
  // The header owns its hosts for its entire lifetime, not just while tabs are collapsed.
  // Otherwise a host remount can temporarily route navigation into the shell's separate toolbar.
  onMount(() => slot.register(props.side, mount))
  return (
    <div
      ref={mount}
      data-slot={`titlebar-navigation-${props.side}`}
      class="flex h-[var(--shell-header-height,48px)] shrink-0 items-center"
      style={{
        display: slot.collapsed() ? undefined : "none",
        "padding-inline-start": props.side === "start" ? "var(--tabs-control-inset, 0px)" : undefined,
      }}
    />
  )
}
