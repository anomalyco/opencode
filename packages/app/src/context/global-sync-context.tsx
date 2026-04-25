/* @refresh skip */
import { createContext, useContext, type ParentProps } from "solid-js"

export type GlobalSyncContextValue = ReturnType<typeof import("./global-sync").createGlobalSync>

export const GlobalSyncContext = createContext<GlobalSyncContextValue>()

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}

export function GlobalSyncProvider(props: ParentProps<{ value: GlobalSyncContextValue }>) {
  return <GlobalSyncContext.Provider value={props.value}>{props.children}</GlobalSyncContext.Provider>
}
