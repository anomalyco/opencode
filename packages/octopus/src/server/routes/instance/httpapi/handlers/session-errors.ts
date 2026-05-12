import type { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import { Effect } from "effect"
import * as ApiError from "../errors"

type StorageNotFound = InstanceType<typeof StorageNotFoundError>

export function mapStorageNotFound<A, R>(self: Effect.Effect<A, StorageNotFound, R>) {
  return self.pipe(Effect.mapError((error) => ApiError.notFound(error.data.message)))
}
