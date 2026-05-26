import { Config } from "@/config/config"
import { Context, Effect, Layer, Schema } from "effect"

const PatentRecord = Schema.Struct({
  patentId: Schema.String,
  title: Schema.String,
  abstract: Schema.String,
  applicant: Schema.String,
  ipc: Schema.String,
})
export type PatentRecord = Schema.Schema.Type<typeof PatentRecord>

class PatentSearchUnavailableError extends Schema.TaggedErrorClass<PatentSearchUnavailableError>()(
  "PatentSearchUnavailableError",
  { message: Schema.String },
) {
  override get message(): string {
    return this.message
  }
}

export interface Interface {
  readonly search: (query: {
    keyword?: string
    ipc?: string
    applicant?: string
    limit?: number
  }) => Effect.Effect<PatentRecord[], PatentSearchUnavailableError>
  readonly isAvailable: () => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentSearch") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const isAvailable = Effect.fn("PatentSearch.isAvailable")(function* () {
      const patentConfig = (yield* config.get()).patent?.search
      return patentConfig?.backend !== "none" && patentConfig?.backend !== undefined
    })

    const search = Effect.fn("PatentSearch.search")(function* (query: {
      keyword?: string
      ipc?: string
      applicant?: string
      limit?: number
    }) {
      const available = yield* isAvailable()
      if (!available) {
        return yield* new PatentSearchUnavailableError({ message: "Patent search is not available" })
      }
      return yield* new PatentSearchUnavailableError({ message: "Patent search backend not implemented" })
    })

    return Service.of({ search, isAvailable })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as PatentSearch from "./search"