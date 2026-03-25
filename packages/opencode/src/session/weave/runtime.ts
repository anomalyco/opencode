import type { ModelMessage } from "ai"
import type { MessageV2 } from "@/session/message-v2"
import { WeaveContext } from "./context"
import { WeaveDB } from "./db"
import type { BuildContextOutput, ExecutionRole } from "./types"

export namespace WeaveRuntime {
  export async function buildModelMessages(input: {
    sessionID: string
    role: ExecutionRole
    sourceMessages: MessageV2.WithParts[]
    modelMessages: ModelMessage[]
  }): Promise<BuildContextOutput> {
    await WeaveDB.ensure(input.sessionID)
    for (const item of input.sourceMessages) {
      await WeaveDB.upsertMessageLink(input.sessionID, item.info.id, `weave:${item.info.id}`)
    }
    const result = await WeaveContext.buildActiveContext({
      sessionID: input.sessionID,
      role: input.role,
      messages: input.sourceMessages,
      modelMessages: input.modelMessages,
    })
    await WeaveDB.appendSnapshot(input.sessionID, result.snapshot)
    return result
  }
}
