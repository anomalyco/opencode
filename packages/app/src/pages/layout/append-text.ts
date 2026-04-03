import { makeEventListener } from "@solid-primitives/event-listener"

export const appendTextEvent = "opencode:append-text"

type AppendTextDetail = { text: string; action: string }

const pendingAppends: AppendTextDetail[] = []

export const pushAppendText = (detail: AppendTextDetail) => {
  pendingAppends.push(detail)
  window.dispatchEvent(new CustomEvent(appendTextEvent, { detail }))
}

export const drainPendingAppends = () => {
  const items = [...pendingAppends]
  pendingAppends.length = 0
  return items
}

export const useAppendTextListener = (cb: (detail: AppendTextDetail) => void) => {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<AppendTextDetail>).detail
    if (detail) cb(detail)
  }
  makeEventListener(window, appendTextEvent, handler as EventListener)
  return () => window.removeEventListener(appendTextEvent, handler)
}
