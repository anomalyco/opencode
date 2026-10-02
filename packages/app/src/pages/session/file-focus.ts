import { createSignal } from "solid-js"

export type PendingFileFocus = {
  path: string
  line: number
  end?: number
  token: number
}

// Module-level signal so any part of the app can request that an open file tab
// scroll to a line, without threading context through the tab system.
const [focus, setFocus] = createSignal<PendingFileFocus>()
let token = 0

export function requestFileFocus(target: { path: string; line: number; end?: number }) {
  token += 1
  setFocus({ ...target, token })
}

export function clearFileFocus(token: number) {
  if (focus()?.token !== token) return
  setFocus()
}

export function pendingFileFocus() {
  return focus()
}
