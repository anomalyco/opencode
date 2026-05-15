import type { Event } from "@opencode-ai/sdk/v2"
import { useProject } from "./project"
import { useSDK } from "./sdk"

type EventMetadata = {
  workspace: string | undefined
}

type NormalizedEvent = {
  id: string
  type: string
  properties: any
}

function normalizeEvent(payload: unknown) {
  if (!payload || typeof payload !== "object") return
  if (!("type" in payload) || typeof payload.type !== "string") return

  if (payload.type === "sync") {
    if (!("name" in payload) || typeof payload.name !== "string") return
    if (!("id" in payload) || typeof payload.id !== "string") return
    const type = payload.name.replace(/\.\d+$/, "")
    const properties = "data" in payload && payload.data && typeof payload.data === "object" ? payload.data : {}
    return { id: payload.id, type, properties } satisfies NormalizedEvent
  }

  if (!("id" in payload) || typeof payload.id !== "string") return
  if (!("properties" in payload) || !payload.properties || typeof payload.properties !== "object") return
  return payload as NormalizedEvent
}

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: any, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      const normalized = normalizeEvent(event.payload)
      if (!normalized) return

      if (event.directory === "global" || event.project === project.project()) {
        handler(normalized, { workspace: event.workspace })
      }
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ): VoidFunction
  function on(type: string, handler: (event: NormalizedEvent, metadata: EventMetadata) => void): VoidFunction
  function on(type: string, handler: (event: any, metadata: EventMetadata) => void) {
    return subscribe((event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}
