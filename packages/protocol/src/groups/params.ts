import { Session } from "@opencode/schema/session"
import { Schema } from "effect"

// Path and query parameters shared across groups. Descriptions go on the key with `annotateKey`, so the shared
// component schemas such as `Session.ID` keep their own description.
const sessionID = "Session ID, as returned by session.create or session.list."

export const Params = {
  sessionID: Session.ID.annotateKey({ description: sessionID }),
  formSessionID: Schema.String.annotateKey({ description: sessionID }),
}
