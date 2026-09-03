import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/runtime/server/api"
import { selectSessionUserMessages, selectVisibleSessionUserMessages } from "@/session/session-domain"

const pageLimit = 200

export async function fetchSessionMessages(input: {
  sessionID: string
  api: Pick<ServerApi, "message">
}): Promise<SessionMessageInfo[]> {
  const pages = [await input.api.message.list({ sessionID: input.sessionID, limit: pageLimit, order: "asc" })]

  while (pages.at(-1)?.cursor.next) {
    pages.push(
      await input.api.message.list({
        sessionID: input.sessionID,
        limit: pageLimit,
        cursor: pages.at(-1)!.cursor.next ?? undefined,
      }),
    )
  }

  return pages.flatMap((page) => page.data)
}

export function selectForkableUserMessages(messages: SessionMessageInfo[], revertMessageID?: string) {
  return selectVisibleSessionUserMessages(selectSessionUserMessages(messages), revertMessageID).filter(
    (message) => !!message.text,
  )
}
