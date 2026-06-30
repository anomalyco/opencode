export * as SessionSchema from "./schema"

import { Session } from "@opencode-ai/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Session.Info
export type Info = Session.Info
