import { Context } from "../util/context"
import type { WorkspaceID } from "./schema"

interface Context {
  workspaceID?: WorkspaceID
}

const context = Context.create<Context>("workspace")

export const WorkspaceContext = {
  async provide<R>(input: { workspaceID?: WorkspaceID; fn: () => R }): Promise<R> {
    return context.provide({ workspaceID: input.workspaceID }, async () => {
      return input.fn()
    })
  },

  get workspaceID() {
    try {
      return context.use().workspaceID
    } catch (e) {
      return undefined
    }
  },
}
