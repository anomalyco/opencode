export type TabOrderItem =
  | {
      type: "session"
      server: string
      sessionId: string
    }
  | {
      type: "draft"
      draftID: string
    }

export const tabOrderKey = (tab: TabOrderItem) =>
  tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${tab.sessionId}`

export function swapTabOrder<T extends TabOrderItem>(tabs: readonly T[], first: TabOrderItem, second: TabOrderItem) {
  const firstKey = tabOrderKey(first)
  const secondKey = tabOrderKey(second)
  if (firstKey === secondKey) return tabs.slice()

  const firstIndex = tabs.findIndex((tab) => tabOrderKey(tab) === firstKey)
  const secondIndex = tabs.findIndex((tab) => tabOrderKey(tab) === secondKey)
  if (firstIndex === -1 || secondIndex === -1) return tabs.slice()

  const next = tabs.slice()
  next[firstIndex] = tabs[secondIndex]!
  next[secondIndex] = tabs[firstIndex]!
  return next
}
