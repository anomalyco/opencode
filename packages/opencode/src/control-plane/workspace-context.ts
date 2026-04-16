import { LocalContext } from "../util"
import type { WorkspaceID } from "../control-plane/schema"

export interface WorkspaceContext {
  workspaceID: string
}

const context = LocalContext.create<WorkspaceContext>("instance")

export const WorkspaceContext = {
  async provide<R>(input: { workspaceID: WorkspaceID; fn: () => R }): Promise<R> {
    return context.provide({ workspaceID: input.workspaceID as string }, () => input.fn())
  },

  restore<R>(workspaceID: string, fn: () => R): R {
    return context.provide({ workspaceID }, fn)
  },

  get workspaceID() {
    try {
      return context.use().workspaceID
    } catch {
      return undefined
    }
  },
}
