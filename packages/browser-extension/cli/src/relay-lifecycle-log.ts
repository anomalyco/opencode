import fs from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import { isUnsupportedDirectorySyncError } from "./fs-durability.ts"
import { RelayShutdownRequest } from "./relay-schema.ts"

const requestFields = {
  instanceId: RelayShutdownRequest.fields.instanceId,
  requestId: RelayShutdownRequest.fields.requestId,
  client: RelayShutdownRequest.fields.client,
}

export const RelayLifecycleEvent = Schema.TaggedUnion({
  Requested: requestFields,
  Cancelled: requestFields,
  Stopping: requestFields,
  Closed: { instanceId: RelayShutdownRequest.fields.instanceId },
  Ready: {
    instanceId: RelayShutdownRequest.fields.instanceId,
    buildId: RelayShutdownRequest.fields.client.fields.buildId,
    restartRequestId: Schema.optionalKey(RelayShutdownRequest.fields.requestId),
  },
})
export type RelayLifecycleEvent = typeof RelayLifecycleEvent.Type

// Lifecycle transitions are rare and must be recorded before stopping the relay.
// Synchronous bounded writes cannot finish out of order after request cancellation.
export function appendRelayLifecycleEvent(filePath: string, event: RelayLifecycleEvent): void {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  const entry = `${JSON.stringify({ ...Schema.encodeSync(RelayLifecycleEvent)(event), timestamp: new Date().toISOString() })}\n`
  const file = fs.openSync(filePath, "a+", 0o600)
  try {
    fs.fchmodSync(file, 0o600)
    if (fs.fstatSync(file).size + Buffer.byteLength(entry) > 256_000) fs.ftruncateSync(file, 0)
    fs.writeFileSync(file, entry)
    fs.fsyncSync(file)
  } finally {
    fs.closeSync(file)
  }
  const parent = fs.openSync(directory, "r")
  try {
    try {
      fs.fsyncSync(parent)
    } catch (error) {
      if (!isUnsupportedDirectorySyncError(error)) throw error
    }
  } finally {
    fs.closeSync(parent)
  }
}
