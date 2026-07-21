import type { Effect } from "effect"

export interface Npm {
  add(pkg: string): Effect.Effect<
    {
      readonly directory: string
      readonly entrypoint?: string
    },
    unknown
  >
}
