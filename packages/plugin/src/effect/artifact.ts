import type { Artifact } from "@opencode/schema/artifact"
import type { Session } from "@opencode/schema/session"
import type { Effect, Schema } from "effect"
import type { Transform } from "./registration.js"

export interface ArtifactFile {
  readonly bytes: Uint8Array
  readonly contentType: string
}

export interface ArtifactTarget {
  readonly id: Artifact.ID
  readonly title: string
  readonly receipt?: Schema.Json
}

export interface ArtifactPublishInput {
  readonly id: Artifact.ID
  readonly title: string
  /** The entry file, relative to `assets`. */
  readonly entry: string
  readonly visibility: Artifact.Visibility
  readonly destination: string
  readonly manifest: Artifact.Manifest
  /** The public files, relative to the folder they're served from. */
  readonly assets: Readonly<Record<string, ArtifactFile>>
  /** The server bundle and migration files, by their path in the artifact. Never served. */
  readonly serverFiles: Readonly<Record<string, Uint8Array>>
  /** What the last create or update returned. */
  readonly receipt?: Schema.Json
  readonly sessionID?: Session.ID
}

export interface ArtifactPublished {
  readonly url?: string
  /** Saved with the artifact and passed back to every later call, such as the resource IDs it created. */
  readonly receipt?: Schema.Json
}

export interface ArtifactProviderDefinition {
  readonly id: string
  readonly name: string
  readonly capabilities: readonly Artifact.Capability[]
  readonly audiences: readonly Artifact.Visibility[]
  readonly defaultAudience: Artifact.Visibility
  readonly prompt: string
  /**
   * Where publishing would go right now, such as `cloudflare:<accountId>`, with no side effects and no secrets. An
   * artifact is pinned to it when created, and updates and deletes refuse while it differs.
   */
  readonly destination: (target: ArtifactTarget) => Effect.Effect<string, unknown>
  readonly create: (input: ArtifactPublishInput) => Effect.Effect<ArtifactPublished, unknown>
  readonly update: (id: Artifact.ID, input: ArtifactPublishInput) => Effect.Effect<ArtifactPublished, unknown>
  /** Reads the live files of a host others edit too. Without it, reads use the snapshot saved at the last publish. */
  readonly read?: (
    id: Artifact.ID,
    receipt?: Schema.Json,
  ) => Effect.Effect<Readonly<Record<string, Uint8Array>>, unknown>
  readonly delete: (id: Artifact.ID, receipt?: Schema.Json) => Effect.Effect<void, unknown>
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
