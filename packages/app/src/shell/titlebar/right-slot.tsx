import { createContext, onCleanup, onMount, Show, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"

type Registration = {
  active: () => boolean
  register: () => void
  unregister: () => void
}

type TitlebarRightSlot = {
  createRegistration: () => Registration
  mount: () => HTMLElement | undefined
  setMount: (mount: HTMLElement) => void
}

const TitlebarRightContext = createContext<TitlebarRightSlot>()

export function TitlebarRightProvider(props: ParentProps) {
  return (
    <TitlebarRightContext.Provider value={createTitlebarRightSlot()}>{props.children}</TitlebarRightContext.Provider>
  )
}

export function createTitlebarRightSlot(): TitlebarRightSlot {
  const [store, setStore] = createStore<{ mount?: HTMLElement; registrations: symbol[] }>({ registrations: [] })
  return {
    mount: () => store.mount,
    setMount: (mount) => setStore("mount", mount),
    createRegistration() {
      const id = Symbol()
      return {
        active: () => store.registrations.at(-1) === id,
        register: () => setStore("registrations", (items) => [...items, id]),
        unregister: () => setStore("registrations", (items) => items.filter((item) => item !== id)),
      }
    },
  }
}

export function TitlebarRightMount() {
  const slot = useTitlebarRightSlot()
  return <div ref={slot.setMount} id="opencode-titlebar-right" class="flex shrink-0 items-center justify-end gap-0" />
}

export function TitlebarRight(props: ParentProps) {
  const slot = useTitlebarRightSlot()
  const registration = slot.createRegistration()
  onMount(() => {
    registration.register()
    onCleanup(registration.unregister)
  })

  return (
    <Show when={registration.active() && slot.mount()} keyed>
      {(mount) => <Portal mount={mount}>{props.children}</Portal>}
    </Show>
  )
}

function useTitlebarRightSlot() {
  const slot = useContext(TitlebarRightContext)
  if (!slot) throw new Error("TitlebarRight must be used within TitlebarRightProvider")
  return slot
}
