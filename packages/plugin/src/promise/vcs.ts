import type { VcsApi } from "@opencode-ai/client/promise/api"
import type { FileDiff } from "@opencode-ai/schema/file-diff"
import type { Vcs } from "@opencode-ai/schema/vcs"
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
  readonly context: number
  readonly maxOutputBytes: number
}

export interface VcsDefinition {
  readonly id: string
  readonly name: string
  readonly info: (input: VcsScope, context: { readonly signal: AbortSignal }) => Promise<Vcs.Info>
  readonly branches: (input: VcsBranchesInput, context: { readonly signal: AbortSignal }) => Promise<Vcs.BranchList>
  readonly status: (input: VcsScope, context: { readonly signal: AbortSignal }) => Promise<readonly Vcs.FileStatus[]>
  readonly diff: (input: VcsDiffInput, context: { readonly signal: AbortSignal }) => Promise<readonly FileDiff.Info[]>
}

export interface VcsDomain extends VcsApi {
  readonly transform: Transform<VcsDraft>
  readonly reload: () => Promise<void>
}

export interface VcsDraft {
  add(definition: VcsDefinition): void
  readonly default: {
    get(): string | undefined
    set(selection: string): void
  }
}
