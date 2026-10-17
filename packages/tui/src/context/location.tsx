import type { LocationGetOutput, LocationRef } from "@opencode/client"
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

// A flapping connection needs a moment to recover before the location is declared
// unreachable: a single failed request right after a reconnect must not surface the
// recovery prompt (#55250).
const RETRIES = 3
const RETRY_DELAY = 500

export function createLocation(input: {
  data: {
    location: {
      info(ref?: LocationRef): LocationGetOutput | undefined
      default(): LocationRef
      sync(ref?: LocationRef): Promise<void>
    }
  }
  connection: { status(): string }
  event: { on(type: "server.connected", listener: () => void): () => void }
  // Retry backoff; shortened in tests.
  delay?: number
}) {
  const [ref, setRef] = createSignal<LocationRef>()
  const [error, setError] = createSignal<{ readonly location: LocationRef; readonly cause: unknown }>()
  let generation = 0
  let disposed = false
  const current = createMemo(() => input.data.location.info(ref()))

  async function settle(location: LocationRef, attempt: number, target: LocationRef | undefined) {
    for (let remaining = RETRIES; ; remaining--) {
      try {
        await input.data.location.sync(target)
        return
      } catch (cause) {
        if (!active(location, attempt)) return
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, input.delay ?? RETRY_DELAY))
          // A sync that was superseded while backing off must not fire another round.
          if (!active(location, attempt)) return
          continue
        }
        setError({ location, cause })
        return
      }
    }
  }

  // Whether this attempt still owns the target location and the provider is alive.
  function active(location: LocationRef, attempt: number) {
    if (disposed) return false
    const at = ref()
    return generation === attempt && at?.directory === location.directory && at.workspaceID === location.workspaceID
  }

  function sync(location?: LocationRef) {
    if (!location) return
    const attempt = ++generation
    const defaultLocation = input.data.location.default()
    const target =
      location.directory === defaultLocation.directory && location.workspaceID === defaultLocation.workspaceID
        ? undefined
        : location
    setError(undefined)
    void settle(location, attempt, target)
  }

  function set(location?: LocationRef) {
    setRef(location)
    if (input.connection.status() === "connected") sync(location)
  }

  onCleanup(() => {
    disposed = true
  })
  onCleanup(input.event.on("server.connected", () => sync(ref())))

  return {
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
  }
}

export function LocationProvider(props: ParentProps) {
  const client = useClient()
  const data = useData()
  return (
    <context.Provider value={createLocation({ data, connection: client.connection, event: client.event })}>
      {props.children}
    </context.Provider>
  )
}

export function useLocation() {
  const value = useContext(context)
  if (!value) throw new Error("Location context must be used within a LocationProvider")
  return value
}
