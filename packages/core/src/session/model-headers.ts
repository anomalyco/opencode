export * as SessionModelHeaders from "./model-headers"

import { App } from "../app"
import { SessionSchema } from "./schema"

export const make = (session: Pick<SessionSchema.Info, "id" | "parentID" | "projectID">, app: App.Info) => ({
  "x-session-affinity": session.id,
  "X-Session-Id": session.id,
  ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
  "User-Agent": App.useragent(app),
  "x-opencode-project": session.projectID,
  "x-opencode-session": session.id,
  "x-opencode-client": app.name,
})
