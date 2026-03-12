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
  projectDirectory: z.string().optional(),
})
export type WorkspaceInfo = z.infer<typeof WorkspaceInfo>

export type Adaptor = {
  detect?(directory: string): boolean | Promise<boolean>
  configure(input: WorkspaceInfo): WorkspaceInfo | Promise<WorkspaceInfo>
  create(input: WorkspaceInfo, from?: WorkspaceInfo): Promise<void>
  remove(config: WorkspaceInfo): Promise<void>
  reset?(config: WorkspaceInfo): Promise<void>
  fetch(config: WorkspaceInfo, input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}
