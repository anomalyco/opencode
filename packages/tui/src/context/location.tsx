import type { LocationGetOutput, LocationRef } from "@opencode-ai/client"
import { createContext, createMemo, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"
import { useClient } from "./client"
import { useData } from "./data"

const context = createContext<{
  readonly current: LocationGetOutput | undefined
  // The target location as set, available before the server-synced info in `current` arrives.
  readonly ref: LocationRef | undefined
  readonly error: { readonly location: LocationRef; readonly cause: unknown } | undefined
  set: (location?: LocationRef) => void
}>()

export function LocationProvider(props: ParentProps) {
  const client = useClient()
  const data = useData()
  const [ref, setRef] = createSignal<LocationRef>()
  const [error, setError] = createSignal<{ readonly location: LocationRef; readonly cause: unknown }>()
  let generation = 0
  const current = createMemo(() => data.location.info(ref()))

  function sync(location?: LocationRef) {
    if (!location) return
    const attempt = ++generation
    const defaultLocation = data.location.default()
    const target =
      location.directory === defaultLocation.directory && location.workspaceID === defaultLocation.workspaceID
        ? undefined
        : location
    setError(undefined)
    void data.location.sync(target).catch((cause) => {
      const current = ref()
      if (
        generation !== attempt ||
        current?.directory !== location.directory ||
        current.workspaceID !== location.workspaceID
      )
        return
      setError({ location, cause })
    })
  }

  function set(location?: LocationRef) {
    setRef(location)
    if (client.connection.status() === "connected") sync(location)
  }

  onCleanup(client.event.on("server.connected", () => sync(ref())))

  return (
    <context.Provider
      value={{
        get current() {
          return current()
        },
        get ref() {
          return ref()
        },
        get error() {
          return error()
        },
        set,
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export function useLocation() {
  const value = useContext(context)
  if (!value) throw new Error("Location context must be used within a LocationProvider")
  return value
}
