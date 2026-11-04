import { createContext, createMemo, getOwner, useContext, type Accessor, type ParentProps } from "solid-js"

const Context = createContext<Accessor<boolean>>(() => true)

/** Disabling a subtree also disables every nested interactivity provider. */
export function InteractivityProvider(props: ParentProps<{ enabled: boolean }>) {
  const parent = useInteractivity()
  const enabled = createMemo(() => parent() && props.enabled)
  return <Context.Provider value={enabled}>{props.children}</Context.Provider>
}

/** Shared by keymap consumers and native input/focus handlers. Defaults to enabled. */
export function useInteractivity() {
  return useContext(Context)
}

/** Forwarded APIs use the calling component's context, or their captured context outside a Solid owner. */
export function resolveInteractivity(fallback: Accessor<boolean>) {
  return getOwner() ? useInteractivity() : fallback
}
