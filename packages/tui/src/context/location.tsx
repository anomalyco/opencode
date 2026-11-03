import {
  isLocationNotFoundError,
  isServiceUnavailableError,
  type LocationGetOutput,
  type LocationRef,
} from "@opencode/client"
import { retry } from "@opencode/util/retry"
import { createContext, createMemo, createSignal, onCleanup, useContext, type ParentProps } from "solid-js"
import { useClient } from "./client"
import { useData } from "./data"
import { useToastOptional } from "../ui/toast"

const context = createContext<{
  readonly current: LocationGetOutput | undefined
  // The target location as set, available before the server-synced info in `current` arrives.
  readonly ref: LocationRef | undefined
  readonly error: { readonly location: LocationRef; readonly cause: unknown } | undefined
  set: (location?: LocationRef) => void
}>()

// A cold Location, e.g. a Windows UNC path, can take longer than the server's 5s plugin activation
// deadline to boot, and each catalog request returns 503 in the meantime. Keep retrying until the
// Location warms up rather than giving up after three attempts and leaving the composer dead.
const LOCATION_READY_TIMEOUT = 5 * 60 * 1000

export function LocationProvider(props: ParentProps) {
  const client = useClient()
  const data = useData()
  const toast = useToastOptional()
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
    // Only the server's typed LocationNotFoundError proves the folder is gone. Other failures, such as
    // 503s while plugins are still activating after a restart, are retried until the Location warms up.
    void retry(() => (generation === attempt ? data.location.sync(target) : Promise.resolve()), {
      delay: 1_000,
      maxDelay: 5_000,
      timeout: LOCATION_READY_TIMEOUT,
      retryIf: (cause) => generation === attempt && !isLocationNotFoundError(cause),
    }).catch((cause) => {
      const current = ref()
      const stale =
        generation !== attempt ||
        current?.directory !== location.directory ||
        current.workspaceID !== location.workspaceID
      if (stale) return
      if (isLocationNotFoundError(cause)) {
        setError({ location, cause })
        return
      }
      // The catalog never loaded, so the prompt cannot send. Say so instead of failing silently.
      if (isServiceUnavailableError(cause)) {
        toast?.error(`${cause.message}. Check the server logs, then run /reload to retry.`)
      } else {
        toast?.error(cause)
      }
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
