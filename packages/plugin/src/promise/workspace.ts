import type { Workspace } from "@opencode/schema/workspace"
import type { Schema } from "effect"
import type { WorkspaceEnvironment, WorkspaceInfo } from "../effect/workspace.js"
import type { Transform } from "./registration.js"

export interface WorkspaceConnectionInput {
  readonly workspaceID: Workspace.ID
  readonly binding: Schema.JsonObject
  readonly saveBinding: (binding: Schema.JsonObject) => Promise<void>
}

export interface WorkspaceDriver {
  readonly create: (
    input: { readonly workspaceID: Workspace.ID },
    context: { readonly signal: AbortSignal },
  ) => Promise<{ readonly binding: Schema.JsonObject }>
  readonly connect: (
    input: WorkspaceConnectionInput,
    context: { readonly signal: AbortSignal },
  ) => Promise<WorkspaceEnvironment>
  readonly suspendForIdle: (input: WorkspaceConnectionInput, context: { readonly signal: AbortSignal }) => Promise<void>
  readonly destroy: (
    input: { readonly workspaceID: Workspace.ID; readonly binding: Schema.JsonObject | null },
    context: { readonly signal: AbortSignal },
  ) => Promise<void>
}

export interface WorkspaceEditor {
  add(name: string, driver: WorkspaceDriver): void
  remove(name: string): void
}

export interface ExperimentalWorkspaceDomain {
  readonly transform: Transform<WorkspaceEditor>
  readonly providers: () => Promise<readonly string[]>
  readonly create: (input: { readonly id?: string; readonly provider: string }) => Promise<string>
  readonly provision: (workspaceID: string) => Promise<WorkspaceInfo>
  readonly destroy: (workspaceID: string) => Promise<Workspace.DestroyResult>
}
