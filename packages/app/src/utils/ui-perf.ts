import { isServer } from "solid-js/web"

const debugKey = "opencode.ui.debug"

function debug() {
  if (isServer) return false
  try {
    return window.localStorage.getItem(debugKey) === "1"
  } catch {
    return false
  }
}

type Pending = {
  eventTime: number
  handlerTime: number
}

const pending = new Map<string, Pending>()

export function uiPerfTriggerDown(name: string, event: { timeStamp: number }) {
  if (!debug()) return
  pending.set(name, {
    eventTime: event.timeStamp,
    handlerTime: performance.now(),
  })
}

export function uiPerfOpen(name: string, open: boolean) {
  if (!debug()) return
  if (!open) {
    pending.delete(name)
    return
  }
  if (!pending.has(name)) return
  pending.delete(name)
}
