import type { Workspace } from "@opencode/schema/workspace"
import type { Effect, Schema, Scope } from "effect"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type { FilesImpl } from "./environment-files.js"
import type { Transform } from "./registration.js"

export interface WorkspaceEnvironment {
  readonly spawner: ChildProcessSpawner["Service"]
  readonly overrides?: Partial<FilesImpl>
}

export interface WorkspaceConnectionInput {
  readonly workspaceID: Workspace.ID
  readonly binding: Schema.JsonObject
  readonly saveBinding: (binding: Schema.JsonObject) => Effect.Effect<void>
}

export interface WorkspaceDriver {
  /** Get or create the same backing resource on every retry for this workspace ID. */
  readonly create: (input: {
    readonly workspaceID: Workspace.ID
  }) => Effect.Effect<{ readonly binding: Schema.JsonObject }, unknown>
  readonly connect: (input: WorkspaceConnectionInput) => Effect.Effect<WorkspaceEnvironment, unknown, Scope.Scope>
  readonly suspendForIdle: (input: WorkspaceConnectionInput) => Effect.Effect<void, unknown>
  /** A null binding still requires cleanup by workspace ID if an interrupted create allocated a resource. */
  readonly destroy: (input: {
    readonly workspaceID: Workspace.ID
    readonly binding: Schema.JsonObject | null
  }) => Effect.Effect<void, unknown>
}

export interface WorkspaceEditor {
  add(name: string, driver: WorkspaceDriver): void
  remove(name: string): void
}

export interface WorkspaceInfo {
  readonly id: string
  readonly provider: string
  readonly createdAt: number
  readonly lastUsedAt: number
}

export interface ExperimentalWorkspaceDomain {
  readonly transform: Transform<WorkspaceEditor>
  readonly providers: () => Effect.Effect<readonly string[]>
  readonly create: (input: { readonly id?: string; readonly provider: string }) => Effect.Effect<string, unknown>
  readonly provision: (workspaceID: string) => Effect.Effect<WorkspaceInfo, unknown>
  readonly destroy: (workspaceID: string) => Effect.Effect<Workspace.DestroyResult, unknown>
}
