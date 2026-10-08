import type { SessionTab, Tab, TabInfo } from "./tabs"
import type { TabStorage } from "./schema"

export type ClosedTab = typeof TabStorage.ClosedTab.Type

const CLOSED_TAB_LIMIT = 25

// Only session tabs are recorded; closing a draft tab deletes its persisted
// state, so a reopened draft would come back empty anyway.
export function pushClosedTab(stack: ClosedTab[], tab: Tab, index: number, info?: TabInfo): ClosedTab[] {
  if (tab.type !== "session") return stack

  const entry: ClosedTab = { tab: { ...tab }, index }

  if (info) entry.info = { ...info }

  return [...stack.filter((item) => !sameTab(item.tab, tab)), entry].slice(-CLOSED_TAB_LIMIT)
}

export function listClosedTabs(stack: ClosedTab[], tabs: Tab[]) {
  const seen = new Set<string>()

  return stack.toReversed().filter((entry) => {
    const key = `${entry.tab.server}\n${entry.tab.sessionId}`

    if (seen.has(key)) return false
    seen.add(key)

    return !isOpen(tabs, entry.tab)
  })
}

export type TakenClosedTab = { entry?: ClosedTab; stack: ClosedTab[] }

// Pops the most recently closed tab that is not open again,
// discarding stale entries along the way.
export function takeClosedTab(stack: ClosedTab[], tabs: Tab[], target?: SessionTab): TakenClosedTab {
  if (target) {
    const index = stack.findLastIndex((entry) => sameTab(entry.tab, target))
    const entry = stack[index]

    if (!entry || isOpen(tabs, entry.tab)) return { stack }

    return { entry, stack: [...stack.slice(0, index), ...stack.slice(index + 1)] }
  }

  const remaining = [...stack]

  while (remaining.length) {
    const entry = remaining.pop()

    if (entry && !isOpen(tabs, entry.tab)) return { entry, stack: remaining }
  }

  return { stack: remaining }
}

export function removeClosedTabs(stack: ClosedTab[], server: SessionTab["server"], sessionIDs: string[]) {
  const removed = new Set(sessionIDs)

  return stack.filter((entry) => entry.tab.server !== server || !removed.has(entry.tab.sessionId))
}

export function nextTabAfterClose(tabs: Tab[], index: number, active: boolean) {
  if (!active) return undefined

  return tabs[index + 1] ?? tabs[index - 1] ?? null
}

function isOpen(tabs: Tab[], tab: SessionTab) {
  return tabs.some((item) => item.type === "session" && sameTab(item, tab))
}

function sameTab(first: SessionTab, second: SessionTab) {
  return first.server === second.server && first.sessionId === second.sessionId
}
