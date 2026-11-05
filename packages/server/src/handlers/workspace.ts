import { Workspace } from "@opencode/core/workspace"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { ConflictError, ProviderNotFoundError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { WorkspaceNotFoundError } from "@opencode/protocol/groups/workspace"
import { Effect } from "effect"

export const makeWorkspace = Effect.gen(function* () {
  const workspaces = yield* Workspace.Service
  const drivers = yield* WorkspaceDriver.RegistryService
  const missingProvider = (error: WorkspaceDriver.ProviderNotFound) =>
    new ProviderNotFoundError({
      providerID: error.provider,
      message: `Workspace provider not found: ${error.provider}`,
    })
  const unavailable = () => new ServiceUnavailableError({ message: "Workspace provider operation failed" })

  return {
    providers: () => drivers.list().pipe(Effect.map((data) => ({ data }))),
    create: (input: Parameters<Workspace.Interface["create"]>[0]) =>
      workspaces.create(input).pipe(
        Effect.map((id) => ({ data: { id, provider: input.provider } })),
        Effect.catchTags({
          "WorkspaceDriver.ProviderNotFound": missingProvider,
          "Workspace.CreateConflict": (error) =>
            new ConflictError({
              resource: error.workspaceID,
              message: `Workspace already belongs to ${error.existingProvider}`,
            }),
        }),
      ),
    provision: (workspaceID: Workspace.ID) =>
      workspaces.provision(workspaceID).pipe(
        Effect.map((info) => ({
          data: { id: info.id, provider: info.provider, createdAt: info.createdAt, lastUsedAt: info.lastUsedAt },
        })),
        Effect.catchTags({
          "Workspace.NotFound": () =>
            new WorkspaceNotFoundError({ workspaceID, message: `Workspace not found: ${workspaceID}` }),
          "WorkspaceDriver.ProviderNotFound": missingProvider,
          "WorkspaceDriver.Error": unavailable,
        }),
      ),
    destroy: (workspaceID: Workspace.ID) =>
      workspaces.destroy(workspaceID).pipe(
        Effect.map((data) => ({ data })),
        Effect.catchTags({ "WorkspaceDriver.ProviderNotFound": missingProvider, "WorkspaceDriver.Error": unavailable }),
      ),
  }
})
