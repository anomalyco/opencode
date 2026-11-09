import { createComponent, createContext, useContext, type ParentProps } from "solid-js"

type WorkspaceLocation = {
  directory: string
  ref: { directory: string }
  current: undefined
  error: undefined
  event: {
    on: () => () => undefined
    listen: () => () => undefined
  }
}

function makeLocation(directory: string): WorkspaceLocation {
  return {
    directory,
    ref: { directory },
    current: undefined,
    error: undefined,
    event: {
      on: () => () => undefined,
      listen: () => () => undefined,
    },
  }
}

const defaultLocation = makeLocation("/tmp/story")

const LocationContext = createContext<() => WorkspaceLocation>()

export function useWorkspaceLocation() {
  return useContext(LocationContext) ?? (() => defaultLocation)
}

export function LocationProvider(props: ParentProps<{ directory?: string }>) {
  const accessor = () => (props.directory ? makeLocation(props.directory) : defaultLocation)

  return createComponent(LocationContext.Provider, {
    value: accessor,
    get children() {
      return props.children
    },
  })
}
