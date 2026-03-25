import type { BuildContextInput, BuildContextOutput, ContextSnapshot } from "./types"

export namespace WeaveContext {
  export async function buildActiveContext(input: BuildContextInput): Promise<BuildContextOutput> {
    const recentMessageIDs = input.messages.slice(-16).map((item) => item.info.id)
    const snapshot: ContextSnapshot = {
      sessionID: input.sessionID,
      role: input.role,
      summaryNodeIDs: [],
      recentMessageIDs,
      fileRefs: [],
      createdAt: Date.now(),
    }

    // Phase 2 seam: preserve existing prompt behavior while centralizing context assembly.
    return {
      modelMessages: input.modelMessages,
      snapshot,
    }
  }
}
