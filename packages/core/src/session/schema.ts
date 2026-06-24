export * as SessionSchema from "./schema"

import { Session } from "@opencode-ai/schema/session"
import type { ExternalID } from "../schema"

export const ID = Session.ID
export type ID = typeof ID.Type
export type { ExternalID }

export const Info = Session.Info
export type Info = Session.Info
