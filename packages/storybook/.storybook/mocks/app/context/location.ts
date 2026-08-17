const location = {
  directory: "/tmp/story",
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
