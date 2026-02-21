import { create } from "@bufbuild/protobuf"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import {
  ProjectSchema,
  ListProjectsResponseSchema,
  ProjectIconSchema,
  ProjectCommandsSchema,
  ProjectTimeSchema,
  type ListProjectsRequest,
  type GetCurrentProjectRequest,
  type UpdateProjectRequest,
} from "../gen/opencode/v1/project_pb"

function toProtoProject(info: Project.Info) {
  const icon = info.icon
    ? create(ProjectIconSchema, {
        ...(info.icon.url ? { url: info.icon.url } : {}),
        ...(info.icon.override ? { override: info.icon.override } : {}),
        ...(info.icon.color ? { color: info.icon.color } : {}),
      })
    : undefined

  const commands = info.commands
    ? create(ProjectCommandsSchema, {
        ...(info.commands.start ? { start: info.commands.start } : {}),
      })
    : undefined

  const time = create(ProjectTimeSchema, {
    created: BigInt(info.time.created),
    updated: BigInt(info.time.updated),
    ...(info.time.initialized !== undefined ? { initialized: BigInt(info.time.initialized) } : {}),
  })

  return create(ProjectSchema, {
    id: info.id,
    worktree: info.worktree,
    name: info.name,
    time,
    sandboxes: info.sandboxes,
    ...(info.vcs ? { vcs: info.vcs } : {}),
    ...(icon ? { icon } : {}),
    ...(commands ? { commands } : {}),
  })
}

export const project = {
  async list(_req: ListProjectsRequest) {
    const projects = await Project.list()
    return create(ListProjectsResponseSchema, {
      projects: projects.map(toProtoProject),
    })
  },

  async getCurrent(_req: GetCurrentProjectRequest) {
    return toProtoProject(Instance.project)
  },

  async update(req: UpdateProjectRequest) {
    const info = await Project.update({
      projectID: req.projectId,
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.icon !== undefined
        ? {
            icon: {
              url: req.icon.url,
              override: req.icon.override,
              color: req.icon.color,
            },
          }
        : {}),
      ...(req.commands !== undefined
        ? {
            commands: {
              start: req.commands.start,
            },
          }
        : {}),
    })
    return toProtoProject(info)
  },
}
