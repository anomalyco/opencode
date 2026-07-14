import type { LocationRef } from "@opencode-ai/client"
import { createContext, createSignal, useContext, type Accessor, type ParentProps, type Setter } from "solid-js"

const context = createContext<{
  current: Accessor<LocationRef | undefined>
  set: Setter<LocationRef | undefined>
}>()

export function LocationProvider(props: ParentProps) {
  const [current, set] = createSignal<LocationRef>()
  return <context.Provider value={{ current, set }}>{props.children}</context.Provider>
}

export function useLocation() {
  const value = useContext(context)
  if (!value) throw new Error("Location context must be used within a LocationProvider")
  return value.current
}

export function useSetLocation() {
  const value = useContext(context)
  if (!value) throw new Error("Location context must be used within a LocationProvider")
  return value.set
}
