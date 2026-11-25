import type { Artifact } from "@opencode/schema/artifact"
import type { Schema } from "effect"
import type { ArtifactPublished, ArtifactPublishInput, ArtifactTarget } from "../effect/artifact.js"
import type { Transform } from "./registration.js"

export type { ArtifactFile, ArtifactPublished, ArtifactPublishInput, ArtifactTarget } from "../effect/artifact.js"

type Signal = { readonly signal: AbortSignal }

export interface ArtifactProviderDefinition {
  readonly id: string
  readonly name: string
  readonly capabilities: readonly Artifact.Capability[]
  readonly audiences: readonly Artifact.Visibility[]
  readonly defaultAudience: Artifact.Visibility
  readonly prompt: string
  readonly destination: (target: ArtifactTarget, context: Signal) => Promise<string>
  readonly create: (input: ArtifactPublishInput, context: Signal) => Promise<ArtifactPublished>
  readonly update: (id: Artifact.ID, input: ArtifactPublishInput, context: Signal) => Promise<ArtifactPublished>
  readonly read?: (
    id: Artifact.ID,
    receipt: Schema.Json | undefined,
    context: Signal,
  ) => Promise<Readonly<Record<string, Uint8Array>>>
  readonly delete: (id: Artifact.ID, receipt: Schema.Json | undefined, context: Signal) => Promise<void>
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
  readonly reload: () => Promise<void>
}
