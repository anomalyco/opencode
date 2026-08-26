import { onCleanup, onMount, Show, type ParentProps } from "solid-js"
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

// Module-level singleton slot. The provider and consumers all reference this
// instance, which sidesteps SolidJS context propagation issues across lazy-loaded
// route chunks where useSlot would otherwise throw "must be used within
// TitlebarRightProvider" even though the provider is mounted.
const [slotStore, setSlotStore] = createStore<{ mount?: HTMLElement; registrations: symbol[] }>({
  registrations: [],
})

const slot: TitlebarRightSlot = {
  mount: () => slotStore.mount,
  setMount: (mount) => setSlotStore("mount", mount),
  createRegistration() {
    const id = Symbol()
    return {
      active: () => slotStore.registrations.at(-1) === id,
      register: () => setSlotStore("registrations", (items) => [...items, id]),
      unregister: () => setSlotStore("registrations", (items) => items.filter((item) => item !== id)),
    }
  },
}

export function TitlebarRightProvider(props: ParentProps) {
  return <>{props.children}</>
}

export function createTitlebarRightSlot(): TitlebarRightSlot {
  const [store, setStore] = createStore<{ mount?: HTMLElement; registrations: symbol[] }>({
    registrations: [],
  })
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
  return <div ref={slot.setMount} id="opencode-titlebar-right" class="flex shrink-0 items-center justify-end gap-0" />
}

export function TitlebarRight(props: ParentProps) {
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
