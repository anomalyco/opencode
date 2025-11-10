import type { OpencodeClient, Event } from "@opencode-ai/sdk/client"
import { createSimpleContext } from "./helper"
import { onCleanup } from "solid-js"

type EventEmitter = {
  emit: <T extends Event["type"]>(type: T, event: Extract<Event, { type: T }>) => void
  listen: (callback: (event: { details: Event }) => void) => void
}

function createEventEmitter(): EventEmitter {
  const listeners: Array<(event: { details: Event }) => void> = []

  return {
    emit: (type, event) => {
      listeners.forEach((cb) => cb({ details: event }))
    },
    listen: (callback) => {
      listeners.push(callback)
      return () => {
        const index = listeners.indexOf(callback)
        if (index > -1) listeners.splice(index, 1)
      }
    },
  }
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { client: OpencodeClient }) => {
    const emitter = createEventEmitter()
    const abort = new AbortController()

    props.client.event.subscribe({ signal: abort.signal }).then(async (events) => {
      for await (const event of events.stream) {
        console.log("event", event.type)
        emitter.emit(event.type, event)
      }
    })

    onCleanup(() => {
      abort.abort()
    })

    return { client: props.client, event: emitter }
  },
})
