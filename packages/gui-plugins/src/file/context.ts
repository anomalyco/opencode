import { createContext, useContext, type Accessor } from "solid-js"
import type { Browser } from "@opencode/plugin/gui/browser"
import type { Changes } from "@opencode/plugin/gui/review"
import type { LineRange, Live, MountedSession, OpenOptions } from "@opencode/plugin/gui"
import type { OpenApp } from "./apps"
import type { PickerView } from "./picker-machine"

/** Per-window file state that setup owns and its lazily loaded views share. */
export interface FileShared {
  readonly changes: Accessor<Live<Changes>>
  readonly browser: Accessor<Live<Browser>>
  /** The file browser's per-session filter state and its filter input's focus request. */
  readonly filter: {
    get(session: string): string
    set(session: string, value: string): void
    browsing(session: string): boolean
    setBrowsing(session: string, value: boolean): void
    /** The focus request a filter input in this view should take, if any. */
    focusRequest(view: PickerView): number | undefined
    /** The filter input took the request's focus. */
    focused(request: number): void
  }
  /** The open-in-app choice. Desktop only. */
  readonly app?: { current(): OpenApp; set(app: OpenApp): void }
  /**
   * The window's open-in-app checks and launch, shared so every "Open in" control agrees: the header buttons, the path
   * menu, file trees and artifact toolbars.
   */
  readonly openInApp: {
    /** Checks the apps not checked yet, by the names the desktop opens them with. */
    check(openWith: readonly string[]): void
    /** The app answered that it is installed. */
    installed(openWith: string): boolean
    /** A launch is running. */
    opening(): boolean
    /** Opens or reveals `target`; ignored while another launch runs. */
    launch(input: { app: OpenApp; target: string; openWith?: string; reveal: boolean }): void
  }
  /** The last selection of each file tab, readable before a session's file view state loads. */
  readonly handoff: {
    get(session: string, path: string): LineRange | null | undefined
    set(session: string, files: Record<string, LineRange | null>): void
  }
  /** Reveals a selected line range on a mounted file view when a link action targets it. */
  readonly reveal: {
    register(session: string, path: string, run: () => void): () => void
    run(session: string, path: string): void
  }
  /** The tab is the session's selected side tab. */
  active(session: MountedSession, id: string): boolean
  open(session: MountedSession, path: string, options?: OpenOptions): void
}

export const FileContext = createContext<FileShared>()

export function useShared() {
  const value = useContext(FileContext)

  if (!value) throw new Error("File views render inside the file plugin")

  return value
}

/** A provider's value while it is active; views that only show its data render nothing from it otherwise. */
export function current<T>(live: Live<T>) {
  return live.status === "active" ? live.value : undefined
}
