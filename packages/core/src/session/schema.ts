export * as SessionSchema from "@opencode/schema/session"

import { Session } from "@opencode/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Persisted = Session.Persisted
export type Persisted = Session.Persisted

export const Info = Session.Info
export type Info = Session.Info
