export * as SessionSchema from "./schema"

import { Schema } from "effect"
import { Session } from "@opencode-ai/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Session.Info
export type Info = Session.Info

export const AgentMemoryID = Schema.String.check(Schema.isStartsWith("mem")).pipe(Schema.brand("AgentMemoryID"))
export type AgentMemoryID = Schema.Schema.Type<typeof AgentMemoryID>
