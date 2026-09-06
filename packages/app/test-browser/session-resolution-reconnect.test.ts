import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionResolution } from "@/session/session-resolution"

test("reloads the transcript and queued inputs each time the connection returns", () => {
  const syncs = { session: 0, message: 0, pending: 0 }
  const sessions = {
    get: () => undefined,
    sync: () => {
      syncs.session++
      return Promise.resolve()
    },
    message: {
      sync: () => {
        syncs.message++
        return Promise.resolve()
      },
    },
    pending: {
      sync: () => {
        syncs.pending++
        return Promise.resolve()
      },
    },
  }
  const [connected, setConnected] = createSignal(true)
  const dispose = createRoot((dispose) => {
    createSessionResolution(
      () => "ses_open",
      () => sessions,
      { children: true, connected },
    )
    return dispose
  })
  try {
    expect(syncs).toEqual({ session: 1, message: 1, pending: 1 })
    setConnected(false)
    expect(syncs).toEqual({ session: 1, message: 1, pending: 1 })
    setConnected(true)
    expect(syncs).toEqual({ session: 2, message: 2, pending: 2 })
  } finally {
    dispose()
  }
})
