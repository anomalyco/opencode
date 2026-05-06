import type { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import { Effect, Schema } from "effect"

export class ApiNotFoundError extends Schema.ErrorClass<ApiNotFoundError>("NotFoundError")(
  {
    name: Schema.Literal("NotFoundError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 404 },
) {}

export function notFound(message: string) {
  return new ApiNotFoundError({
    name: "NotFoundError",
    data: { message },
  })
}

export function mapStorageNotFound<A, R>(
  self: Effect.Effect<A, InstanceType<typeof StorageNotFoundError>, R>,
) {
  return self.pipe(Effect.mapError((error) => notFound(error.data.message)))
}
