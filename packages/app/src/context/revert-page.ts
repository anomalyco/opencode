import type { Message, Part } from "@opencode-ai/sdk/v2/client"

type MessagePage = {
  session: Message[]
  part: { id: string; part: Part[] }[]
  cursor?: string
  complete: boolean
  clearedRevert?: boolean
}

type MessageWithParts = {
  info: Message
  parts: Part[]
  cursor?: string
}

export type RevertTarget = {
  messageID: string
  partID?: string
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
export const compareMessages = (a: Message, b: Message) => a.time.created - b.time.created || cmp(a.id, b.id)
export const messageBefore = (message: Message, boundary: Message) => compareMessages(message, boundary) < 0

const sortParts = (parts: Part[]) => parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id))

// A part-level revert keeps the boundary message itself visible (with trimmed parts), so a
// user boundary counts as the visible user and no older history is required to render it.
export function hasVisibleUserBeforeRevert(messages: readonly Message[], revert?: RevertTarget, boundary?: Message) {
  if (!revert?.messageID) return true
  const resolved = boundary ?? messages.find((message) => message.id === revert.messageID)
  if (!resolved) return false
  return messages.some(
    (message) =>
      message.role === "user" && (messageBefore(message, resolved) || (message.id === resolved.id && !!revert.partID)),
  )
}

function mergeMessages(current: Message[], older: Message[], boundary: Message) {
  const merged = new Map(current.filter((message) => !!message?.id).map((message) => [message.id, message] as const))
  for (const message of older) {
    if (!message?.id) continue
    merged.set(message.id, message)
  }
  merged.set(boundary.id, boundary)
  return [...merged.values()].sort(compareMessages)
}

function mergeParts(current: MessagePage["part"], older: MessagePage["part"], boundary: MessageWithParts) {
  const merged = new Map(current.filter((item) => !!item?.id).map((item) => [item.id, sortParts(item.part)] as const))
  for (const item of older) {
    if (!item?.id) continue
    merged.set(item.id, sortParts(item.part))
  }
  merged.set(boundary.info.id, sortParts(boundary.parts))
  return [...merged.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, part]) => ({ id, part }))
}

export async function loadRevertAwareLatestPage(input: {
  current: MessagePage
  revert?: RevertTarget
  fetchMessage: (messageID: string) => Promise<MessageWithParts | undefined>
  fetchPage: (before: string) => Promise<MessagePage>
}) {
  if (!input.revert?.messageID) return input.current

  const boundary = await input.fetchMessage(input.revert.messageID)
  if (!boundary) return { ...input.current, clearedRevert: true }
  const current = {
    ...input.current,
    session: mergeMessages(input.current.session, [], boundary.info),
    part: mergeParts(input.current.part, [], boundary),
    cursor: boundary.cursor ?? input.current.cursor,
    complete: !boundary.cursor && !input.current.cursor,
  }
  if (hasVisibleUserBeforeRevert(current.session, input.revert, boundary.info)) return current
  if (!current.cursor) return current

  const cursors = new Set<string>()
  const ids = new Set(current.session.map((message) => message.id))
  let older: MessagePage = current
  let session = current.session
  let part = current.part
  let cursor: string | undefined = current.cursor
  while (!hasVisibleUserBeforeRevert(session, input.revert, boundary.info) && cursor) {
    if (cursors.has(cursor)) throw new Error("Message pagination cursor did not advance")
    cursors.add(cursor)
    older = await input.fetchPage(cursor)
    const unseen = older.session.filter((message) => !ids.has(message.id))
    unseen.forEach((message) => ids.add(message.id))
    session = mergeMessages(session, older.session, boundary.info)
    part = mergeParts(part, older.part, boundary)
    cursor = older.cursor
    if (!hasVisibleUserBeforeRevert(session, input.revert, boundary.info) && cursor && unseen.length === 0)
      throw new Error("Message pagination returned no new messages")
  }
  return {
    session,
    part,
    cursor: older.cursor,
    complete: older.complete,
  }
}
