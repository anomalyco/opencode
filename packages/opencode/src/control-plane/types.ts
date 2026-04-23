import z from "zod"
import { ProjectID } from "@/project/schema"
import { WorkspaceID } from "./schema"

export const WorkspaceInfo = z.object({
  id: WorkspaceID.zod,
  type: z.string(),
  branch: z.string().nullable(),
  name: z.string().nullable(),
  directory: z.string().nullable(),
  extra: z.unknown().nullable(),
  projectID: ProjectID.zod,
})
export type WorkspaceInfo = z.infer<typeof WorkspaceInfo>

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

export type Adaptor = {
  configure(input: WorkspaceInfo): WorkspaceInfo | Promise<WorkspaceInfo>
  create(config: WorkspaceInfo, from?: WorkspaceInfo): Promise<void>
  remove(config: WorkspaceInfo): Promise<void>
  target(config: WorkspaceInfo): Target | Promise<Target>
}
