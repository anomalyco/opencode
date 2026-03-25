import { ulid } from "ulid"
import type { ExecutionRole, ThreadDispatch } from "./types"
import { WeaveDB } from "./db"

export namespace WeaveThread {
  export async function dispatch(input: {
    sessionID: string
    parentSessionID: string
    action: string
    delegatedScope?: string
    role?: ExecutionRole
    toolProfile?: string
    modelOverride?: string
  }) {
    const dispatch: ThreadDispatch = {
      threadID: ulid(),
      parentSessionID: input.parentSessionID,
      action: input.action,
      delegatedScope: input.delegatedScope,
      role: input.role ?? "thread",
      toolProfile: input.toolProfile,
      modelOverride: input.modelOverride,
    }
    await WeaveDB.appendDispatch(input.sessionID, dispatch)
    return dispatch
  }
}
