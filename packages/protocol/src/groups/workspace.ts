import { Workspace } from "@opencode/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"
import { ConflictError, ProviderNotFoundError, ServiceUnavailableError } from "../errors.js"

export class WorkspaceNotFoundError extends Schema.TaggedError<WorkspaceNotFoundError>()(
  "WorkspaceNotFoundError",
  { workspaceID: Workspace.ID, message: Schema.String },
  { httpApiStatus: 404 },
) {}

const root = "/api/experimental/workspace"
const params = { workspaceID: Workspace.ID }
const workspace = { id: Workspace.ID, provider: Schema.String }
const annotations = (method: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.workspace.${method}`,
    summary,
    description: `${description} Experimental: may change without compatibility guarantees.`,
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

export const WorkspaceEndpoints = [
  HttpApiEndpoint.get("workspace.providers", `${root}/providers`, {
    success: Schema.Struct({ data: Schema.Array(Schema.String) }),
  }).annotateMerge(annotations("providers", "List workspace providers", "List registered workspace driver names.")),
  HttpApiEndpoint.post("workspace.create", root, {
    payload: Schema.Struct({ id: Schema.optional(Workspace.ID), provider: Schema.String }),
    success: Schema.Struct({ data: Schema.Struct(workspace) }),
    error: [ProviderNotFoundError, ConflictError],
  }).annotateMerge(annotations("create", "Create workspace", "Allocate a workspace ID without provisioning it.")),
  HttpApiEndpoint.post("workspace.provision", `${root}/:workspaceID`, {
    params,
    success: Schema.Struct({
      data: Schema.Struct({ ...workspace, createdAt: Schema.Number, lastUsedAt: Schema.Number }),
    }),
    error: [WorkspaceNotFoundError, ProviderNotFoundError, ServiceUnavailableError],
  }).annotateMerge(annotations("provision", "Provision workspace", "Ensure the backing resource is ready.")),
  HttpApiEndpoint.delete("workspace.destroy", `${root}/:workspaceID`, {
    params,
    success: Schema.Struct({ data: Workspace.DestroyResult }),
    error: [ProviderNotFoundError, ServiceUnavailableError],
  }).annotateMerge(
    annotations("destroy", "Destroy workspace", "Release the provider resource and remove the workspace."),
  ),
] as const
