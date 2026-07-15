export * as SessionModelHeaders from "./model-headers"

import { Flag } from "../flag/flag"
import { InstallationVersion } from "../installation/version"
import { SessionSchema } from "./schema"

export const make = (session: Pick<SessionSchema.Info, "id" | "parentID" | "projectID">) => ({
  "x-session-affinity": session.id,
  "X-Session-Id": session.id,
  ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
  "User-Agent": `opencode/${InstallationVersion}`,
  "x-opencode-project": session.projectID,
  "x-opencode-session": session.id,
  "x-opencode-client": Flag.OPENCODE_CLIENT,
})
