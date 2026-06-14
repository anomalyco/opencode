import { Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const StorageOperation = Schema.Literals(["read", "write", "exists"])
export type StorageOperation = Schema.Schema.Type<typeof StorageOperation>

export class EvolutionStorageError extends Schema.TaggedErrorClass<EvolutionStorageError>()("EvolutionStorageError", {
  message: Schema.String,
  operation: StorageOperation,
  path: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect),
}) {}

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
