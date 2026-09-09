import { useParams } from "@solidjs/router"
import { createContext, type ParentProps, useContext } from "solid-js"

type RouteParams = {
  serverKey?: string
  dir?: string
  id?: string
}

const RouteParamsContext = createContext<RouteParams>()

export function RouteParamsProvider(props: ParentProps<{ value: RouteParams }>) {
  return <RouteParamsContext.Provider value={props.value}>{props.children}</RouteParamsContext.Provider>
}

export function useRouteParams() {
  return useContext(RouteParamsContext) ?? useParams<RouteParams>()
}
