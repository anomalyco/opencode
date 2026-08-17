const location = {
  directory: "/tmp/story",
  ref: { directory: "/tmp/story" },
  current: undefined,
  error: undefined,
  event: {
    on: () => () => undefined,
    listen: () => () => undefined,
  },
}

export function useWorkspaceLocation() {
  return () => location
}

export function LocationProvider(props: { children?: unknown }) {
  return props.children
}
