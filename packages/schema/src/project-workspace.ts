export * as ProjectWorkspace from "./project-workspace.js"

import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema.js"
import { Project } from "./project.js"
import { Session } from "./session.js"

export const FolderStatus = Schema.Literals(["active", "missing", "unreadable"]).annotate({
  identifier: "ProjectWorkspace.FolderStatus",
})
export type FolderStatus = typeof FolderStatus.Type

export const WorkspaceFolder = Schema.Struct({
  id: Schema.String,
  projectID: Project.ID,
  path: AbsolutePath,
  name: Schema.String,
  isPrimary: Schema.Boolean,
  drive: optional(Schema.String),
  vcs: optional(Schema.String),
  status: FolderStatus,
  addedAt: Schema.Finite,
}).annotate({ identifier: "ProjectWorkspace.WorkspaceFolder" })
export interface WorkspaceFolder extends Schema.Schema.Type<typeof WorkspaceFolder> {}

export const AttachmentCategory = Schema.Literals(["source", "document", "data", "image", "archive", "other"]).annotate({
  identifier: "ProjectWorkspace.AttachmentCategory",
})
export type AttachmentCategory = typeof AttachmentCategory.Type

export const ProjectAttachment = Schema.Struct({
  id: Schema.String,
  projectID: Project.ID,
  name: Schema.String,
  originalPath: Schema.String,
  storagePath: Schema.String,
  mimeType: Schema.String,
  category: AttachmentCategory,
  size: Schema.Finite,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
  indexed: Schema.Boolean,
  extractedSummary: optional(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "ProjectWorkspace.ProjectAttachment" })
export interface ProjectAttachment extends Schema.Schema.Type<typeof ProjectAttachment> {}

export const ProjectConversation = Schema.Struct({
  sessionID: Session.ID,
  projectID: Project.ID,
  title: Schema.String,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
  messageCount: Schema.Int,
  status: Schema.Literals(["active", "archived"]),
}).annotate({ identifier: "ProjectWorkspace.ProjectConversation" })
export interface ProjectConversation extends Schema.Schema.Type<typeof ProjectConversation> {}

export const CreateProjectInput = Schema.Struct({
  name: Schema.String,
  directory: AbsolutePath,
  commands: optional(Project.Commands),
  icon: optional(Project.Icon),
}).annotate({ identifier: "ProjectWorkspace.CreateProjectInput" })
export interface CreateProjectInput extends Schema.Schema.Type<typeof CreateProjectInput> {}

export const DeleteProjectInput = Schema.Struct({
  projectID: Project.ID,
  deletePhysicalFiles: optional(Schema.Boolean),
}).annotate({ identifier: "ProjectWorkspace.DeleteProjectInput" })
export interface DeleteProjectInput extends Schema.Schema.Type<typeof DeleteProjectInput> {}

export const AddFolderInput = Schema.Struct({
  projectID: Project.ID,
  directory: AbsolutePath,
  name: optional(Schema.String),
  isPrimary: optional(Schema.Boolean),
}).annotate({ identifier: "ProjectWorkspace.AddFolderInput" })
export interface AddFolderInput extends Schema.Schema.Type<typeof AddFolderInput> {}

export const RemoveFolderInput = Schema.Struct({
  projectID: Project.ID,
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectWorkspace.RemoveFolderInput" })
export interface RemoveFolderInput extends Schema.Schema.Type<typeof RemoveFolderInput> {}

export const RelinkFolderInput = Schema.Struct({
  projectID: Project.ID,
  oldDirectory: AbsolutePath,
  newDirectory: AbsolutePath,
}).annotate({ identifier: "ProjectWorkspace.RelinkFolderInput" })
export interface RelinkFolderInput extends Schema.Schema.Type<typeof RelinkFolderInput> {}

export const AddAttachmentInput = Schema.Struct({
  projectID: Project.ID,
  name: Schema.String,
  filePath: Schema.String,
  mimeType: optional(Schema.String),
}).annotate({ identifier: "ProjectWorkspace.AddAttachmentInput" })
export interface AddAttachmentInput extends Schema.Schema.Type<typeof AddAttachmentInput> {}
