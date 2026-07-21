export * as SessionModelHeaders from "./model-headers"

import { InstallationVersion } from "../installation/version"
import { SessionSchema } from "./schema"
import { Schema } from "effect"

export const Options = Schema.Struct({
  client: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export const make = (
  session: Pick<SessionSchema.Info, "id" | "parentID" | "projectID">,
  options?: Options,
) => ({
  "x-session-affinity": session.id,
  "X-Session-Id": session.id,
  ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
  "User-Agent": `opencode/${InstallationVersion}`,
  "x-opencode-project": session.projectID,
  "x-opencode-session": session.id,
  "x-opencode-client": options?.client ?? "cli",
})
