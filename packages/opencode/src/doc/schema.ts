import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"
import { SessionID } from "@/session/schema"

export const DocID = Schema.String.pipe(
  Schema.brand("DocID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("doc", id)),
    zod: Identifier.schema("doc").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type DocID = Schema.Schema.Type<typeof DocID>

export const ActorID = Schema.String.pipe(
  Schema.brand("ActorID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("actor", id)),
    zod: Identifier.schema("actor").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type ActorID = Schema.Schema.Type<typeof ActorID>

export const AssetID = Schema.String.pipe(
  Schema.brand("AssetID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("asset", id)),
    zod: z.string().min(1).pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type AssetID = Schema.Schema.Type<typeof AssetID>

export const SubmitID = Schema.String.pipe(
  Schema.brand("SubmitID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("submit", id)),
    zod: Identifier.schema("submit").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type SubmitID = Schema.Schema.Type<typeof SubmitID>

export const CycleID = Schema.String.pipe(
  Schema.brand("CycleID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("cycle", id)),
    zod: Identifier.schema("cycle").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type CycleID = Schema.Schema.Type<typeof CycleID>

export const CycleInputID = Schema.String.pipe(
  Schema.brand("CycleInputID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("cycleInput", id)),
    zod: Identifier.schema("cycleInput").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
export type CycleInputID = Schema.Schema.Type<typeof CycleInputID>

export const SessionIDParam = z.object({
  sessionID: SessionID.zod,
})
