import { isLocationNotFoundError, type LocationGetOutput, type LocationRef } from "@opencode/client"
import { retry } from "@opencode/util/retry"
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
  let recheck: ReturnType<typeof setTimeout> | undefined
  const current = createMemo(() => data.location.info(ref()))

  // `missing` re-checks a location already reported missing, keeping its error until the folder is back.
  function sync(location?: LocationRef, missing = false) {
    clearTimeout(recheck)
    if (!location) return
    const attempt = ++generation
    const defaultLocation = data.location.default()
    const target =
      location.directory === defaultLocation.directory && location.workspaceID === defaultLocation.workspaceID
        ? undefined
        : location
    if (!missing) setError(undefined)
    // Only the server's typed LocationNotFoundError proves the folder is gone. Other failures, such as
    // plugins still activating after a restart, are retried and never block the composer.
    void retry(() => (generation === attempt ? data.location.sync(target) : Promise.resolve()), {
      retryIf: (cause) => generation === attempt && !isLocationNotFoundError(cause),
    }).then(
      () => {
        if (generation === attempt) setError(undefined)
      },
      (cause) => {
        const current = ref()
        if (
          (!missing && !isLocationNotFoundError(cause)) ||
          generation !== attempt ||
          current?.directory !== location.directory ||
          current.workspaceID !== location.workspaceID
        )
          return
        if (!missing) setError({ location, cause })
        // A folder on a drive mounted late or a network share comes back, so keep checking while it is missing.
        recheck = setTimeout(() => sync(location, true), 15_000)
      },
    )
  }

  function set(location?: LocationRef) {
    setRef(location)
    if (client.connection.status() === "connected") sync(location)
  }

  onCleanup(client.event.on("server.connected", () => sync(ref())))
  onCleanup(() => clearTimeout(recheck))

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
