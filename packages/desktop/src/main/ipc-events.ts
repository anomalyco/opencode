import type { WebContents } from "electron"
import type { DesktopEvent } from "../shared/ipc-rpc/events"

type Sink = (sender: WebContents, event: DesktopEvent) => boolean

// The IPC transport owns each window's event stream and registers itself here while its layer lives.
let sink: Sink | undefined

export function setIpcEventSink(next: Sink) {
  sink = next

  return () => {
    if (sink === next) sink = undefined
  }
}

/** Returns false when the renderer has no event stream to receive the event, now or once its document binds. */
export function emitIpcEvent(sender: WebContents, event: DesktopEvent) {
  return sink ? sink(sender, event) : false
}
