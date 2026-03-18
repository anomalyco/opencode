import { useParams } from "@solidjs/router"
import { createContext, useContext, ParentProps } from "solid-js"

const SessionParamsContext = createContext<{ dir?: string; id?: string }>()

export function useSessionParams() {
  const routerParams = useParams<{ dir?: string; id?: string }>()
  const contextParams = useContext(SessionParamsContext)
  return contextParams || routerParams
}

export function SessionParamsProvider(props: ParentProps<{ dir?: string; id?: string }>) {
  return <SessionParamsContext.Provider value={{ dir: props.dir, id: props.id }}>{props.children}</SessionParamsContext.Provider>
}
