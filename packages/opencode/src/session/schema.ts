import { Schema } from "effect"
import z from "zod"

import { withStatics } from "@/util/schema"
import { Identifier } from "@/id/id"

const sessionIdSchema = Schema.String.pipe(Schema.brand("SessionID"))

export type SessionID = typeof sessionIdSchema.Type

export const SessionID = sessionIdSchema.pipe(
  withStatics((schema: typeof sessionIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    descending: (id?: string) => schema.makeUnsafe(Identifier.descending("session", id)),
    zod: Identifier.schema("session").pipe(z.custom<SessionID>()),
  })),
)

const messageIdSchema = Schema.String.pipe(Schema.brand("MessageID"))

export type MessageID = typeof messageIdSchema.Type

export const MessageID = messageIdSchema.pipe(
  withStatics((schema: typeof messageIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("message", id)),
    zod: Identifier.schema("message").pipe(z.custom<MessageID>()),
  })),
)

const partIdSchema = Schema.String.pipe(Schema.brand("PartID"))

export type PartID = typeof partIdSchema.Type

export const PartID = partIdSchema.pipe(
  withStatics((schema: typeof partIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("part", id)),
    zod: Identifier.schema("part").pipe(z.custom<PartID>()),
  })),
)
