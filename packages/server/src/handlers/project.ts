import { Project } from "@opencode/core/project"
import {
  ProjectOperations,
  MultiFolderWorkspace,
  ProjectAttachments,
  ProjectConversations,
} from "@opencode/core/workspace-manager/index"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { ProjectNotFoundError } from "@opencode/protocol/errors"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  handlers
    .handle("project.list", (ctx) => Project.Service.use((project) => project.list(ctx.query)))
    .handle("project.create", (ctx) =>
      ProjectOperations.Service.use((ops) => ops.create(ctx.payload)),
    )
    .handle("project.update", (ctx) =>
      Project.Service.use((project) =>
        project.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
          Effect.mapError(
            () =>
              new ProjectNotFoundError({
                projectID: ctx.params.projectID,
                message: `Project not found: ${ctx.params.projectID}`,
              }),
          ),
        ),
      ),
    )
    .handle("project.delete", (ctx) =>
      ProjectOperations.Service.use((ops) =>
        ops.delete({ projectID: ctx.params.projectID, deletePhysicalFiles: false }).pipe(
          Effect.mapError(
            () =>
              new ProjectNotFoundError({
                projectID: ctx.params.projectID,
                message: `Project not found: ${ctx.params.projectID}`,
              }),
          ),
        ),
      ),
    )
    .handle("project.folders.list", (ctx) =>
      MultiFolderWorkspace.Service.use((mf) => mf.listFolders(ctx.params.projectID)),
    )
    .handle("project.folders.add", (ctx) =>
      MultiFolderWorkspace.Service.use((mf) =>
        mf.addFolder({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(Effect.orDie),
      ),
    )
    .handle("project.folders.remove", (ctx) =>
      MultiFolderWorkspace.Service.use((mf) =>
        mf.removeFolder({ ...ctx.payload, projectID: ctx.params.projectID }),
      ),
    )
    .handle("project.attachments.list", (ctx) =>
      ProjectAttachments.Service.use((pa) => pa.list(ctx.params.projectID)),
    )
    .handle("project.attachments.add", (ctx) =>
      ProjectAttachments.Service.use((pa) =>
        pa.add({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(Effect.orDie),
      ),
    )
    .handle("project.conversations.list", (ctx) =>
      ProjectConversations.Service.use((pc) => pc.list(ctx.params.projectID)),
    ),
)
