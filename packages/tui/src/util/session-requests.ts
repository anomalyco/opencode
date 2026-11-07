import { createMemo, mapArray, type Accessor } from "solid-js"

export function createSessionRequests<T>(
  sessionIDs: Accessor<readonly string[]>,
  list: (sessionID: string) => readonly T[] | undefined,
) {
  const empty: T[] = []
  // Each child hydrates independently. Empty responses must not invalidate the
  // whole family or loading N completed subagents performs N full-family scans.
  const requests = mapArray(sessionIDs, (sessionID) =>
    createMemo(() => {
      const items = list(sessionID)
      return items?.length ? items.slice() : empty
    }),
  )
  return createMemo(() => requests().flatMap((items) => items()))
}
