import { createContext, useContext, type Accessor } from "solid-js"
import type { Browser } from "../browser/contract"
import type { Changes } from "../review/contract"
import type { LineRange, SessionView } from "../sdk"
import type { OpenApp } from "./apps"

export type TreeTab = "changes" | "all"

/** Per-window file state that setup owns and its lazily loaded views share. */
export interface FileShared {
  readonly changes: Accessor<Changes | undefined>
  readonly browser: Accessor<Browser | undefined>
  readonly tree: {
    tab(): TreeTab
    setTab(tab: TreeTab): void
    /** The directory whose root listing the tree last refreshed. */
    directory?: string
  }
  /** The file browser's filter input, focused by the "Open file" menu item even when the browser chunk mounts later. */
  readonly filter: { element?: HTMLInputElement; pending?: boolean }
  /** Open-in-app availability checks, one per app for the window's lifetime. */
  readonly installed: Map<string, Promise<boolean>>
  /** The open-in-app choice. Desktop only. */
  readonly app?: { current(): OpenApp; set(app: OpenApp): void }
  /** The last selection of each file tab, readable before a session's file view state loads. */
  readonly handoff: {
    get(session: string, path: string): LineRange | null | undefined
    set(session: string, files: Record<string, LineRange | null>): void
  }
  /** The tab is the session's selected side tab. */
  active(session: SessionView, id: string): boolean
  open(session: SessionView, path: string, options?: { readonly preview?: boolean }): void
}

export const FileContext = createContext<FileShared>()

export function useShared() {
  const value = useContext(FileContext)
  if (!value) throw new Error("File views render inside the file extension")
  return value
}
