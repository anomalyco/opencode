import type { VcsApi } from "@opencode-ai/client/effect/api"
import type { FileDiff } from "@opencode-ai/schema/file-diff"
import type { Vcs } from "@opencode-ai/schema/vcs"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface VcsScope {
  readonly directory: string
  readonly worktree: string
  readonly canonical: string
  readonly store?: string
}

export interface VcsBranchesInput extends VcsScope {
  readonly search?: string
  readonly limit?: number
}

export interface VcsDiffInput extends VcsScope {
  readonly mode: Vcs.Mode
  readonly base?: string
  readonly context: number
  readonly maxOutputBytes: number
}

export interface VcsDefinition {
  readonly id: string
  readonly name: string
  readonly info: (input: VcsScope) => Effect.Effect<Vcs.Info, unknown>
  readonly base?: (input: VcsScope) => Effect.Effect<Vcs.Base | null, unknown>
  readonly branches: (input: VcsBranchesInput) => Effect.Effect<Vcs.BranchList, unknown>
  readonly status: (input: VcsScope) => Effect.Effect<readonly Vcs.FileStatus[], unknown>
  readonly diff: (input: VcsDiffInput) => Effect.Effect<readonly FileDiff.Info[], unknown>
}

export interface VcsDomain extends VcsApi<unknown> {
  readonly transform: Transform<VcsDraft>
  readonly reload: () => Effect.Effect<void>
}

export interface VcsDraft {
  add(definition: VcsDefinition): void
  readonly default: {
    get(): string | undefined
    set(selection: string): void
  }
}
