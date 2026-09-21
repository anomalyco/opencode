import { createContext, createMemo, createSignal, Show, useContext, type Component, type ParentProps } from "solid-js"

type RouterState = {
  location: () => string
  navigate: (to: string) => void
  params: () => Record<string, string | undefined>
}

const RouterContext = createContext<RouterState>()
const ParamsContext = createContext<() => Record<string, string | undefined>>()

const legacyParams = { dir: "c3Rvcnk=", id: "story-session" }
const legacyLocation = { pathname: "/story/session/story-session", search: "", hash: "" }

export function useParams() {
  const params = useContext(ParamsContext)
  if (!params) return legacyParams
  return { ...legacyParams, ...params() }
}

export function useNavigate() {
  const router = useContext(RouterContext)
  if (!router) return () => undefined
  return router.navigate
}

export function useSearchParams<T extends Record<string, string>>() {
  return [{} as Partial<T>, () => undefined] as const
}

export function useLocation() {
  const router = useContext(RouterContext)
  if (!router) return legacyLocation
  return { pathname: router.location(), search: "", hash: "" }
}

export function createMemoryHistory() {
  let value = "/"
  return {
    get: () => value,
    set(input: { value: string }) {
      value = input.value
    },
  }
}

export function MemoryRouter(props: ParentProps & {
  root?: Component<ParentProps>
  initialEntries?: string[]
  history?: ReturnType<typeof createMemoryHistory>
}) {
  const [location, setLocation] = createSignal(props.history?.get() ?? props.initialEntries?.[0] ?? "/")
  const [params, setParams] = createSignal<Record<string, string | undefined>>({})
  const state: RouterState = {
    location,
    navigate: (to) => setLocation(to.split("?")[0] ?? "/"),
    params,
  }
  const Root = props.root
  return (
    <RouterContext.Provider value={state}>
      <ParamsContext.Provider value={params}>{Root ? <Root>{props.children}</Root> : props.children}</ParamsContext.Provider>
    </RouterContext.Provider>
  )
}

export function Route(props: {
  path?: string
  component?: Component<Record<string, unknown>>
  children?: unknown
}) {
  const router = useContext(RouterContext)
  if (!router) return <>{props.children as never}</>
  const matched = createMemo(() => matchPath(props.path, router.location()))
  return (
    <Show when={matched()}>
      {(value) => (
        <ParamsContext.Provider value={() => value().params}>
          {props.component ? <props.component /> : (props.children as never)}
        </ParamsContext.Provider>
      )}
    </Show>
  )
}

function matchPath(pattern: string | undefined, pathname: string) {
  if (!pattern) return { params: {} as Record<string, string | undefined> }
  const patternParts = pattern.split("/").filter(Boolean)
  const pathParts = pathname.split("/").filter(Boolean)
  if (patternParts.length !== pathParts.length) return
  const params: Record<string, string | undefined> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const segment = patternParts[index]!
    const value = pathParts[index]!
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = value
      continue
    }
    if (segment !== value) return
  }
  return { params }
}
