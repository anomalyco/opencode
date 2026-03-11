import { Schema } from "effect"
import z from "zod"

import { withStatics } from "@/util/schema"
import { Identifier } from "@/id/id"

const sessionIdSchema = Schema.String.pipe(Schema.brand("SessionId"))

export type SessionID = typeof sessionIdSchema.Type

export const SessionID = sessionIdSchema.pipe(
  withStatics((schema: typeof sessionIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    descending: (id?: string) => schema.makeUnsafe(Identifier.descending("session", id)),
    zod: z.string().startsWith("ses").pipe(z.custom<SessionID>()),
  })),
)

const messageIdSchema = Schema.String.pipe(Schema.brand("MessageId"))

export type MessageID = typeof messageIdSchema.Type

export const MessageID = messageIdSchema.pipe(
  withStatics((schema: typeof messageIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("message", id)),
    zod: z.string().startsWith("msg").pipe(z.custom<MessageID>()),
  })),
)
