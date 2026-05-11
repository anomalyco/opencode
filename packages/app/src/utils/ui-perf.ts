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
  const start = pending.get(name)
  if (!start) return
  pending.delete(name)
  const openAt = performance.now()
  requestAnimationFrame(() => {
    const commitAt = performance.now()
    requestAnimationFrame(() => {
      const paintAt = performance.now()
      const handler = (start.handlerTime - start.eventTime).toFixed(1)
      const onOpen = (openAt - start.eventTime).toFixed(1)
      const commit = (commitAt - start.eventTime).toFixed(1)
      const paint = (paintAt - start.eventTime).toFixed(1)
      console.debug(
        `[ui:perf] open name=${name} handler=${handler} open=${onOpen} commit=${commit} paint=${paint}ms`,
      )
    })
  })
}
