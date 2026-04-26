import type { Event } from "@opencode-ai/sdk/v2"
import { homedir } from "os"
import { resolve } from "path"
import { useProject } from "./project"
import { useSDK } from "./sdk"

function normalizePath(p: string) {
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2))
  return resolve(p)
}

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: Event) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      // Special hack for truly global events
      if (event.directory === "global") {
        handler(event.payload)
      }

      if (project.workspace.current()) {
        if (event.workspace === project.workspace.current()) {
          handler(event.payload)
        }

        return
      }

      const multiRootID = project.multiRootWorkspace.current()
      if (multiRootID) {
        const ws = project.multiRootWorkspace.get(multiRootID)
        if (ws?.folders.some((f) => event.directory === normalizePath(f.path))) {
          handler(event.payload)
        }
        return
      }

      if (event.directory === project.instance.directory()) {
        handler(event.payload)
      }
    })
  }

  function on<T extends Event["type"]>(type: T, handler: (event: Extract<Event, { type: T }>) => void) {
    return subscribe((event) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>)
    })
  }

  return {
    subscribe,
    on,
  }
}
