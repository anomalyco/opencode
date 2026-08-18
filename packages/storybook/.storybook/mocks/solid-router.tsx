import type { ParentProps } from "solid-js"

export function useParams() {
  return {
    dir: "c3Rvcnk=",
    id: "story-session",
  }
}

export function useNavigate() {
  return () => undefined
}

export function useSearchParams<T extends Record<string, string>>() {
  return [{} as Partial<T>, () => undefined] as const
}

export function useLocation() {
  return {
    pathname: "/story/session/story-session",
    search: "",
    hash: "",
  }
}

export function MemoryRouter(props: ParentProps) {
  return props.children
}

export function Route(props: ParentProps) {
  return props.children
}
