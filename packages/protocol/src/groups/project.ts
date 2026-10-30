import { Project } from "@opencode/schema/project"
import { ProjectWorkspace } from "@opencode/schema/project-workspace"
import { Schema, SchemaGetter, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ProjectNotFoundError } from "../errors.js"

const root = "/api/project"
const UpdatePayload = Schema.Struct(Struct.omit(Project.UpdateInput.fields, ["projectID"]))
const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
  }),
)

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.get("project.list", root, {
      query: Schema.Struct({ archived: BooleanFromString.pipe(Schema.optional) }),
      success: Schema.Array(Project.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.list",
        summary: "List projects",
        description: "List known projects. Archived projects are excluded unless archived=true.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("project.create", root, {
      payload: ProjectWorkspace.CreateProjectInput,
      success: Project.Info,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.create",
        summary: "Create project",
        description: "Creates a new project in the workspace registry.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("project.update", `${root}/:projectID`, {
      params: { projectID: Project.ID },
      payload: UpdatePayload,
      success: Project.Info,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.update",
        summary: "Update project",
        description: "Update the project canonical directory, display metadata, and workspace commands.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("project.delete", `${root}/:projectID`, {
      params: { projectID: Project.ID },
      success: Schema.Boolean,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.delete",
        summary: "Delete project safely",
        description: "Safely removes project metadata while preserving source directories on disk.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project.folders.list", `${root}/:projectID/folders`, {
      params: { projectID: Project.ID },
      success: Schema.Array(ProjectWorkspace.WorkspaceFolder),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.folders.list",
        summary: "List attached workspace folders",
        description: "Lists all folders attached to this multi-folder workspace.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("project.folders.add", `${root}/:projectID/folders`, {
      params: { projectID: Project.ID },
      payload: Schema.Struct(Struct.omit(ProjectWorkspace.AddFolderInput.fields, ["projectID"])),
      success: ProjectWorkspace.WorkspaceFolder,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.folders.add",
        summary: "Attach folder to project",
        description: "Attaches a new filesystem directory to this project workspace.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("project.folders.remove", `${root}/:projectID/folders`, {
      params: { projectID: Project.ID },
      payload: Schema.Struct(Struct.omit(ProjectWorkspace.RemoveFolderInput.fields, ["projectID"])),
      success: Schema.Boolean,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.folders.remove",
        summary: "Detach folder from project",
        description: "Detaches an attached folder without deleting its files on disk.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project.attachments.list", `${root}/:projectID/attachments`, {
      params: { projectID: Project.ID },
      success: Schema.Array(ProjectWorkspace.ProjectAttachment),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.attachments.list",
        summary: "List project attachments",
        description: "Lists all persistent files and documents attached to the project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("project.attachments.add", `${root}/:projectID/attachments`, {
      params: { projectID: Project.ID },
      payload: Schema.Struct(Struct.omit(ProjectWorkspace.AddAttachmentInput.fields, ["projectID"])),
      success: ProjectWorkspace.ProjectAttachment,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.attachments.add",
        summary: "Add project attachment",
        description: "Uploads and indexes an attachment resource for this project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project.conversations.list", `${root}/:projectID/conversations`, {
      params: { projectID: Project.ID },
      success: Schema.Array(ProjectWorkspace.ProjectConversation),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.conversations.list",
        summary: "List project conversations",
        description: "Lists all persistent sessions associated with this project.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "project",
      description: "Project routes.",
    }),
  )
