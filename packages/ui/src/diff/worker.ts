import { prepareDiff } from "../components/session-diff"
import type { DiffWorkerRequest, DiffWorkerResponse } from "./protocol"

self.addEventListener("message", (event: MessageEvent<DiffWorkerRequest>) => {
  try {
    self.postMessage({ id: event.data.id, result: prepareDiff(event.data.source) } satisfies DiffWorkerResponse)
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies DiffWorkerResponse)
  }
})
