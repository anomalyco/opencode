import { isMessageNotFoundError } from "@opencode/client/promise"
import type { ServerApi, ServerRequestOptions } from "@/runtime/server/api"

export async function withdrawPrompt(
  api: ServerApi,
  sessionID: string,
  messageID: string,
  options?: ServerRequestOptions,
): Promise<"withdrawn" | "delivered"> {
  await api.session.inbox.cancel({ sessionID, inboxID: messageID }, options)

  // Cancel also succeeds when the prompt has already moved into session history.
  try {
    await api.session.message.get({ sessionID, messageID }, options)
    return "delivered"
  } catch (error) {
    if (isMessageNotFoundError(error)) return "withdrawn"
    throw error
  }
}
