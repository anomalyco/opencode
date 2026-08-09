import type { OpenCodeClient } from "@opencode-ai/client"

export async function undoMessage(
  client: OpenCodeClient,
  input: { readonly sessionID: string; readonly messageID: string; readonly pending: boolean },
) {
  const revert = () => client.session.revert.stage(input).then(() => undefined)
  if (!input.pending) return revert()

  return client.session.pending.cancel({ sessionID: input.sessionID, inputID: input.messageID }).catch((error) => {
    if (typeof error !== "object" || error === null || !("_tag" in error) || error._tag !== "ConflictError") throw error
    return revert()
  })
}
