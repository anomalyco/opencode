import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const TeamID = Schema.String.pipe(
  Schema.brand("TeamID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("team", id)),
    zod: Identifier.schema("team").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type TeamID = Schema.Schema.Type<typeof TeamID>

export const TeamTaskID = Schema.String.pipe(
  Schema.brand("TeamTaskID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("team_task", id)),
    zod: Identifier.schema("team_task").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type TeamTaskID = Schema.Schema.Type<typeof TeamTaskID>

export const MemoryID = Schema.String.pipe(
  Schema.brand("MemoryID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("memory", id)),
    zod: Identifier.schema("memory").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type MemoryID = Schema.Schema.Type<typeof MemoryID>
