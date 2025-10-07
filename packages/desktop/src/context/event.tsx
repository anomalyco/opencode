import { createContext, useContext, type ParentProps } from "solid-js"
import { createEventBus } from "@solid-primitives/event-bus"
import type { Event as SDKEvent } from "@opencode-ai/sdk"
import { useSDK } from "@/context"

export type Event = SDKEvent // can extend with custom events later

function init() {
  const sdk = useSDK()
  const bus = createEventBus<Event>()
  sdk.event.subscribe().then(async (events) => {
    for await (const event of events.stream) {
      bus.emit(event)
    }
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
