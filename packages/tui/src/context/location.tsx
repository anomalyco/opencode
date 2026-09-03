import type { LocationGetOutput, LocationRef } from "@opencode-ai/client"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type ParentProps,
} from "solid-js"
import { useClient } from "./client"
import { useData } from "./data"
import { useLog } from "./log"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

const context = createContext<{
  readonly current: LocationGetOutput | undefined
  // The target location as set, available before the server-synced info in `current` arrives.
  readonly ref: LocationRef | undefined
  readonly error: { readonly location: LocationRef; readonly cause: unknown } | undefined
  set: (location?: LocationRef) => void
  retry: () => void
}>()

export function LocationProvider(props: ParentProps) {
  const client = useClient()
  const data = useData()
  const toast = useToast()
  const log = useLog()
  const [ref, setRef] = createSignal<LocationRef>()
  const [error, setError] = createSignal<{ readonly location: LocationRef; readonly cause: unknown }>()
  let generation = 0
  const current = createMemo(() => data.location.info(ref()))

  // A reconnect marks the connection ready before its buffered server.connected event.
  // Invalidate old HTTP attempts at disconnect, not only when the next sync starts.
  createEffect(() => {
    if (client.connection.status() !== "connected") generation++
  })

  function sync(location?: LocationRef) {
    if (!location) return
    const attempt = ++generation
    const defaultLocation = data.location.default()
    const target =
      location.directory === defaultLocation.directory && location.workspaceID === defaultLocation.workspaceID
        ? undefined
        : location
    setError(undefined)
    const active = () =>
      generation === attempt &&
      ref()?.directory === location.directory &&
      ref()?.workspaceID === location.workspaceID &&
      client.connection.status() === "connected"
    let resolved = false
    void data.location
      .syncInfo(target)
      .then(() => {
        // syncInfo is cached: the remaining sync loads catalogs for the resolved location.
        resolved = true
        return data.location.sync(target)
      })
      .catch((cause) => {
        if (!active()) return
        if (!resolved) {
          setError({ location, cause })
          return
        }
        log.error("Session data sync failed", { cause })
        toast.show({
          variant: "error",
          title: "Session data sync failed",
          message: `Some session data could not be loaded (${errorMessage(cause)}).`,
          action: {
            label: "Retry",
            run: () => {
              if (active()) sync(location)
            },
          },
        })
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
        retry: () => sync(ref()),
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
