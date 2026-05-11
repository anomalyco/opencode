import { Schema, Struct } from "effect"
import { ProjectID } from "@/project/schema"
import { WorkspaceID } from "./schema"
import type { DeepMutable } from "@opencode-ai/core/schema"

export const WorkspaceInfo = Schema.Struct({
  id: WorkspaceID,
  type: Schema.String,
  name: Schema.String,
  branch: Schema.NullOr(Schema.String),
  directory: Schema.NullOr(Schema.String),
  extra: Schema.NullOr(Schema.Unknown),
  projectID: ProjectID,
}).annotate({ identifier: "Workspace" })
export type WorkspaceInfo = DeepMutable<Schema.Schema.Type<typeof WorkspaceInfo>>

export const WorkspaceListedInfo = Schema.Struct(Struct.omit(WorkspaceInfo.fields, ["id"])).annotate({
  identifier: "WorkspaceListedInfo",
})
export type WorkspaceListedInfo = DeepMutable<Schema.Schema.Type<typeof WorkspaceListedInfo>>

export const WorkspaceAdapterEntry = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  description: Schema.String,
})
export type WorkspaceAdapterEntry = Schema.Schema.Type<typeof WorkspaceAdapterEntry>

export type Target =
  | {
      type: "local"
      directory: string
    }
  | {
      type: "remote"
      url: string | URL
      headers?: HeadersInit
    }

export type WorkspaceAdapter = {
  name: string
  description: string
  configure(info: WorkspaceInfo): WorkspaceInfo | Promise<WorkspaceInfo>
  create(info: WorkspaceInfo, env: Record<string, string | undefined>, from?: WorkspaceInfo): Promise<void>
  list?(): WorkspaceListedInfo[] | Promise<WorkspaceListedInfo[]>
  remove(info: WorkspaceInfo): Promise<void>
  target(info: WorkspaceInfo): Target | Promise<Target>
}
