import {
  createContext,
  createMemo,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
  type Setter,
} from "solid-js"
import { useData } from "../../context/data"

export type HomeSessionDestination = { type: "directory"; directory: string; subdirectory: boolean } | { type: "new" }

type Context = {
  destination: Accessor<HomeSessionDestination | undefined>
  setDestination: Setter<HomeSessionDestination | undefined>
  clear: () => void
}

const HomeSessionDestinationContext = createContext<Context>()

export function HomeSessionDestinationProvider(props: ParentProps) {
  const data = useData()
  const [selected, setDestination] = createSignal<HomeSessionDestination>()
  const destination = createMemo<HomeSessionDestination>(
    () => selected() ?? { type: "directory", directory: data.location.default().directory, subdirectory: false },
  )
  return (
    <HomeSessionDestinationContext.Provider
      value={{ destination, setDestination, clear: () => setDestination(undefined) }}
    >
      {props.children}
    </HomeSessionDestinationContext.Provider>
  )
}

export function useHomeSessionDestination() {
  return useContext(HomeSessionDestinationContext)
}
