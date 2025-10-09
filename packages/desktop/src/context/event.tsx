import { createContext, useContext, onCleanup, type ParentProps } from "solid-js"
import { createEventBus } from "@solid-primitives/event-bus"
import type { Event as SDKEvent } from "@opencode-ai/sdk"
import { useSDK } from "@/context"

export type Event = SDKEvent // can extend with custom events later

function init() {
  const sdk = useSDK()
  const bus = createEventBus<Event>()
  let controller: AbortController | undefined

  const connect = async () => {
    controller = new AbortController()
    const events = await sdk.event.subscribe()
    for await (const event of events.stream) {
      if (controller.signal.aborted) break
      bus.emit(event)
    }
  }

  connect()

  onCleanup(() => {
    controller?.abort()
  })

  return bus
}

type EventContext = ReturnType<typeof init>

const ctx = createContext<EventContext>()

export function EventProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useEvent() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useEvent must be used within a EventProvider")
  }
  return value
}
