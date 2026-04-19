import type { Session } from "@opencode-ai/sdk/v2"

function compareSession(a: Session, b: Session) {
  return b.time.updated - a.time.updated
}

export function sessionList(
  input: Session[],
  limit: number,
  current: string | undefined,
  searching: boolean,
  pinned: string[] = [],
) {
  const list = input.filter((x) => x.parentID === undefined).toSorted(compareSession)
  if (searching) return list

  const currentRoot = current ? (input.find((x) => x.id === current)?.parentID ?? current) : undefined
  const currentItem = currentRoot ? list.find((x) => x.id === currentRoot) : undefined
  const pinnedItems = [...new Set(pinned)]
    .filter((id) => id !== currentRoot)
    .map((id) => list.find((x) => x.id === id))
    .filter((x): x is Session => x !== undefined)
  const preserved = [...(currentItem ? [currentItem] : []), ...pinnedItems].slice(0, limit)
  const preservedIDs = new Set(preserved.map((x) => x.id))
  return [...list.filter((x) => !preservedIDs.has(x.id)).slice(0, limit - preserved.length), ...preserved].toSorted(
    compareSession,
  )
}
