export * as Instruction from "./instruction.js"

import { Schema } from "effect"

export const Key = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/u)).pipe(
  Schema.brand("Instruction.Key"),
  Schema.annotate({ identifier: "Instruction.Key" }),
)
export type Key = typeof Key.Type

export const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)).pipe(
  Schema.brand("Instruction.Hash"),
  Schema.annotate({ identifier: "Instruction.Hash" }),
)
export type Hash = typeof Hash.Type

export const Values = Schema.Record(Key, Hash)
export type Values = Readonly<Record<string, Hash>>

export const Removed = Schema.Literal("removed")
export type Removed = typeof Removed.Type
export const removed = Removed.make("removed")

export const Delta = Schema.Record(Schema.String, Schema.Union([Hash, Removed]))
export type Delta = typeof Delta.Type
