// Simple context to pass window ID down to children
// No reactivity dependencies - just a static value per window
import { createContext, useContext, type ParentProps } from "solid-js"

const WindowIDContext = createContext<string>("")

export function WindowIDProvider(props: ParentProps<{ windowID: string }>) {
  return <WindowIDContext.Provider value={props.windowID}>{props.children}</WindowIDContext.Provider>
}

export function useWindowID(): string {
  return useContext(WindowIDContext)
}
