import type { Artifact } from "@opencode/schema/artifact"
import type { Session } from "@opencode/schema/session"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface ArtifactProviderCreateInput {
  readonly id: Artifact.ID
  readonly title: string
  readonly entry: string
  readonly files: Readonly<Record<string, Uint8Array>>
  readonly sessionID?: Session.ID
}

export interface ArtifactProviderUpdateInput {
  readonly title: string
  readonly entry: string
  readonly files: Readonly<Record<string, Uint8Array>>
  readonly sessionID?: Session.ID
}

export interface ArtifactProviderResult {
  readonly url?: string
}

export interface ArtifactProviderDefinition {
  readonly id: string
  readonly name: string
  readonly capabilities: readonly Artifact.Capability[]
  readonly prompt: string
  readonly create: (input: ArtifactProviderCreateInput) => Effect.Effect<ArtifactProviderResult, unknown>
  readonly read: (id: Artifact.ID) => Effect.Effect<Readonly<Record<string, Uint8Array>>, unknown>
  readonly update: (
    id: Artifact.ID,
    input: ArtifactProviderUpdateInput,
  ) => Effect.Effect<ArtifactProviderResult, unknown>
  readonly delete: (id: Artifact.ID) => Effect.Effect<void, unknown>
}

export interface ArtifactEditor {
  add(definition: ArtifactProviderDefinition): void
  remove(id: string): void
  readonly default: {
    get(): string | undefined
    set(providerID: string | undefined): void
  }
}

export interface ExperimentalArtifactDomain {
  readonly transform: Transform<ArtifactEditor>
  readonly reload: () => Effect.Effect<void>
}
