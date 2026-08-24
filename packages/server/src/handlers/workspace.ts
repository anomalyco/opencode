import { Workspace } from "@opencode-ai/core/workspace"
import { ConflictError, ProviderNotFoundError, UnknownError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const WorkspaceHandler = HttpApiBuilder.group(Api, "server.workspace", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service

    return handlers
      .handle("workspace.create", (ctx) =>
        workspace.create(ctx.payload).pipe(
          Effect.map((workspaceID) => ({ data: workspaceID })),
          Effect.catchTags({
            "Workspace.CreateConflict": (error) =>
              new ConflictError({
                resource: error.workspaceID,
                message: `Workspace ${error.workspaceID} already uses provider ${error.existingProvider}, not ${error.provider}`,
              }),
            "WorkspaceDriver.ProviderNotFound": (error) =>
              new ProviderNotFoundError({
                providerID: error.provider,
                message: `Workspace provider not found: ${error.provider}`,
              }),
          }),
        ),
      )
      .handle("workspace.destroy", (ctx) =>
        workspace.destroy(ctx.params.workspaceID).pipe(
          Effect.mapError(
            (error) =>
              new UnknownError({
                message:
                  error._tag === "WorkspaceDriver.ProviderNotFound"
                    ? `Workspace provider not found: ${error.provider}`
                    : (error.message ?? "Workspace provider failed to destroy the workspace"),
              }),
          ),
        ),
      )
  }),
)
