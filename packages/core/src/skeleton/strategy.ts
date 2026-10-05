import { Effect } from "effect"

export interface SkeletonResult {
  readonly content: string
  readonly pruned: boolean
  readonly originalLines: number
  readonly skeletonLines: number
}

export interface Strategy {
  readonly name: string
  readonly extensions: readonly string[]
  readonly prune: (filepath: string, content: string) => Effect.Effect<SkeletonResult>
}
