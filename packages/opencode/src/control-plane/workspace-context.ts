import { Context } from "../util/context"

interface Context {
  workspaceID?: string
}

const context = Context.create<Context>("workspace")

export const WorkspaceContext = {
  async provide<R>(input: { workspaceID?: string; fn: () => R }): Promise<R> {
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
