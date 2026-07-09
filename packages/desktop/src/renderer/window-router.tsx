import { createMemoryHistory, MemoryRouter, type BaseRouterProps } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { getDesktopWindowID, type DesktopWindowState } from "./window-state"

function windowLastActiveUrlKey(windowID: string) {
  return `opencode.desktop.window.${windowID}.last-active-url`
}

export function getLastActiveUrl(windowState: DesktopWindowState) {
  if (typeof localStorage !== "object") return "/"
  try {
    const value = localStorage.getItem(windowLastActiveUrlKey(getDesktopWindowID(windowState)))
    if (value?.startsWith("/") && !value.startsWith("//")) return value
  } catch {}
  return "/"
}

function setLastActiveUrl(windowState: DesktopWindowState, value: string) {
  if (typeof localStorage !== "object") return
  try {
    localStorage.setItem(windowLastActiveUrlKey(getDesktopWindowID(windowState)), value)
  } catch {}
}

export function DesktopMemoryRouter(props: BaseRouterProps & { windowState: DesktopWindowState }) {
  const history = createMemoryHistory()
  const initialUrl = getLastActiveUrl(props.windowState)
  if (initialUrl !== "/") history.set({ value: initialUrl, replace: true, scroll: false })
  onCleanup(history.listen((value) => setLastActiveUrl(props.windowState, value)))
  return <MemoryRouter {...props} history={history} />
}
