import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { beforeRevert } from "@opencode/util/session-revert"

export function selectSessionUserMessages(messages: readonly SessionMessageInfo[]) {
  return messages.filter((message): message is SessionMessageUser => message.type === "user")
}

/**
 * How many loaded messages the timeline looks through for the boundary of a staged revert. A boundary in an older page
 * hides every loaded message, so the timeline has nothing to show and loads older pages by itself until it has the
 * boundary. A revert pointer that outlived its message (https://github.com/anomalyco/opencode/issues/63282) names no
 * page at all, and would take that paging to the first message of the session.
 */
export const REVERT_SEARCH_LIMIT = 1_000

/**
 * Whether a revert boundary that is not loaded may be in an older page. Past the limit the timeline stops looking:
 * nothing counts as reverted until the reader's own scrolling loads the boundary.
 */
export function olderMayHoldRevert(loaded: number, more: boolean) {
  return more && loaded < REVERT_SEARCH_LIMIT
}

/**
 * The prompts a revert leaves, by their place in the transcript: message IDs do not sort in that order. `older`: a
 * boundary that is not loaded may be in an older page.
 */
export function selectVisibleSessionUserMessages(
  messages: readonly SessionMessageInfo[],
  revertMessageID: string | undefined,
  older: boolean,
) {
  return selectSessionUserMessages(beforeRevert(messages, revertMessageID, older))
}
