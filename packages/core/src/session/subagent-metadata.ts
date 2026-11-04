export * as SubagentMetadata from "./subagent-metadata.js"

import type { SessionSchema } from "./schema.js"

// Children inherit their parent's whole metadata map, so a spawn that wants the default
// still has to write this key explicitly to override an inherited silent preference.
const NOTIFY = "subagent.notify"

// Absence means report, so parents and children spawned before this key existed stay loud.
export function notify(metadata: SessionSchema.Metadata | undefined) {
  return metadata?.[NOTIFY] !== false
}

// Returns undefined when the child already carries the preference, letting callers skip a write.
export function withNotify(metadata: SessionSchema.Metadata | undefined, value: boolean) {
  if (notify(metadata) === value) return undefined
  return { ...metadata, [NOTIFY]: value }
}
