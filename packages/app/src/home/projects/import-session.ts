import { Schema } from "effect"
import { SessionTransfer } from "@opencode/schema/session-transfer"

// Loaded on demand when a session file is imported: validating it needs the shared Effect schema,
// which stays out of the renderer's startup path this way.
export async function decodeSessionTransfer(text: string) {
  const data = await Schema.decodeUnknownPromise(Schema.fromJsonString(SessionTransfer.Data))(text)
  return Schema.encodeSync(SessionTransfer.Data)(data)
}
