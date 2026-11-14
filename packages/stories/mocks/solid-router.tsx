import { createContext, createMemo, onCleanup, useContext, type Component, type JSX, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"

type LocationState = {
  pathname: string
  search: string
  hash: string
  state?: unknown
}

export type MemoryHistory = {
  get: () => string
  set: (change: { value: string; replace?: boolean; scroll?: boolean; state?: unknown }) => void
  listen: (listener: (value: string) => void) => () => void
  state: () => unknown
}

export function createMemoryHistory(): MemoryHistory {
  let current = "/"

  let currentState: unknown

  const listeners = new Set<(value: string) => void>()

  return {
    get: () => current,
    state: () => currentState,
    set(change) {
      current = change.value
      currentState = change.state
      listeners.forEach((listener) => listener(current))
    },
    listen(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}

type RouterContextValue = {
  location: LocationState
  navigate: (to: string, options?: { replace?: boolean; state?: unknown }) => void
}

const RouterContext = createContext<RouterContextValue>()

const defaultLocation: LocationState = {
  pathname: "/story/session/story-session",
  search: "",
  hash: "",
}

export function useParams() {
  return {
    dir: "c3Rvcnk=",
    id: "story-session",
  }
}

export function useNavigate() {
  const ctx = useContext(RouterContext)

  return (to: string | number, options?: { replace?: boolean; state?: unknown }) => {
    if (typeof to === "string") ctx?.navigate(to, options)
  }
}

export function useSearchParams<T extends Record<string, string>>() {
  const ctx = useContext(RouterContext)

  if (!ctx) return [{} as Partial<T>, () => undefined] as const

  const params = createMemo(() => Object.fromEntries(new URLSearchParams(ctx.location.search)) as Partial<T>)

  const setParams = (next: Record<string, string | undefined>) => {
    const query = new URLSearchParams(ctx.location.search)

    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) query.delete(key)
      else query.set(key, value)
    }

    const search = query.toString()
    ctx.navigate(`${ctx.location.pathname}${search ? `?${search}` : ""}`, { replace: true })
  }

  return [params(), setParams] as const
}

export function useIsRouting() {
  return () => false
}

export function useLocation<S = unknown>() {
  const ctx = useContext(RouterContext)

  if (!ctx) return defaultLocation as LocationState & { state?: S; query: Record<string, string> }

  return {
    get pathname() {
      return ctx.location.pathname
    },
    get search() {
      return ctx.location.search
    },
    get hash() {
      return ctx.location.hash
    },
    get state() {
      return ctx.location.state as S | undefined
    },
    get query() {
      return Object.fromEntries(new URLSearchParams(ctx.location.search))
    },
  }
}

function parseUrl(input: string): Pick<LocationState, "pathname" | "search" | "hash"> {
  const url = new URL(input, "http://story.local")

  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  }
}

export function MemoryRouter(
  props: ParentProps<{
    history?: MemoryHistory
    root?: (props: ParentProps) => JSX.Element
  }>,
) {
  const initial = props.history?.get() ?? "/story/session/story-session"

  const [location, setLocation] = createStore<LocationState>({
    ...parseUrl(initial),
    state: props.history?.state(),
  })

  if (props.history) {
    const stop = props.history.listen((next) => {
      setLocation({
        ...parseUrl(next),
        state: props.history?.state(),
      })
    })
    onCleanup(stop)
  }

  const value: RouterContextValue = {
    location,
    navigate: (to, options) => {
      if (props.history) {
        props.history.set({ value: to, replace: options?.replace, state: options?.state })

        return
      }

      setLocation({
        ...parseUrl(to),
        state: options?.state,
      })
    },
  }

  return (
    <RouterContext.Provider value={value}>
      {props.root
        ? props.root({
            get children() {
              return props.children
            },
          })
        : props.children}
    </RouterContext.Provider>
  )
}

export function Route(props: ParentProps<{ path?: string; component?: Component }>) {
  if (props.component) {
    const Comp = props.component

    return <Comp />
  }

  return props.children
}
