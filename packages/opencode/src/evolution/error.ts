import { Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const StorageOperation = Schema.Literals(["read", "write", "exists", "verify"])
export type StorageOperation = Schema.Schema.Type<typeof StorageOperation>

export class EvolutionStorageError extends Schema.TaggedErrorClass<EvolutionStorageError>()("EvolutionStorageError", {
  message: Schema.String,
  operation: StorageOperation,
  path: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect),
}) {}

export class EvolutionMemoryLimitError extends Schema.TaggedErrorClass<EvolutionMemoryLimitError>()("EvolutionMemoryLimitError", {
  message: Schema.String,
  limit: Schema.optional(Schema.Int),
  count: Schema.Int,
}) {}

export class InvariantViolationError {
  readonly _tag = "InvariantViolationError"
  constructor(readonly payload: { message: string; operation: string }) {}
}

export const toEvolutionStorageError = (
  e: FSUtil.Error,
  operation: StorageOperation,
  path?: string,
): EvolutionStorageError =>
  new EvolutionStorageError({
    message: `Evolution storage error during "${operation}"`,
    operation,
    path,
    cause: e,
  })
