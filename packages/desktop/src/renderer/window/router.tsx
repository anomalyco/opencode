import { createMemoryHistory, MemoryRouter, type BaseRouterProps } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { getLastActiveUrl, setLastActiveUrl } from "./route-storage"

export function DesktopMemoryRouter(props: BaseRouterProps & { windowID: string }) {
  const history = createMemoryHistory()
  const initialUrl = getLastActiveUrl(props.windowID)
  if (initialUrl !== "/") history.set({ value: initialUrl, replace: true, scroll: false })
  onCleanup(history.listen((value) => setLastActiveUrl(props.windowID, value)))
  return <MemoryRouter {...props} history={history} />
}
