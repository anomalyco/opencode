import type { LocationRef } from "@opencode-ai/client"
import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"

const context = createContext<Accessor<LocationRef | undefined>>()

export function LocationProvider(props: ParentProps<{ location?: LocationRef }>) {
  return <context.Provider value={() => props.location}>{props.children}</context.Provider>
}

export function useLocation() {
  const value = useContext(context)
  if (!value) throw new Error("Location context must be used within a LocationProvider")
  return value
}
