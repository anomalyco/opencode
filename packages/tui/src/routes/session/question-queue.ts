import type { QuestionRequest, Session } from "@opencode-ai/sdk/v2"

export function sessionQuestionQueue(
  sessions: Session[],
  questions: Record<string, QuestionRequest[] | undefined>,
  sessionID?: string,
) {
  if (!sessionID) return []

  const children = sessions.reduce((result, session) => {
    if (!session.parentID) return result
    const existing = result.get(session.parentID)
    if (existing) existing.push(session.id)
    if (!existing) result.set(session.parentID, [session.id])
    return result
  }, new Map<string, string[]>())
  const ids = [sessionID]
  const seen = new Set(ids)
  for (const id of ids) {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  return ids.flatMap((id) => questions[id] ?? []).toSorted((a, b) => a.id.localeCompare(b.id))
}

export function activeQuestion(queue: QuestionRequest[], requestID?: string) {
  return queue.find((request) => request.id === requestID) ?? queue[0]
}
